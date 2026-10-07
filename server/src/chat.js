import { pathId, ValidationError } from "./validation.js";

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 6;
const MAX_TAGS = 6;
// Only these open inline in the browser; every other file type is downloaded.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const messageSelect = `SELECT m.id, m.user_id, m.author_name, u.username author_username, m.body, m.tags, m.resolved, m.created_at,
    COALESCE((SELECT json_agg(json_build_object('id', a.id, 'filename', a.filename, 'contentType', a.content_type, 'size', a.size) ORDER BY a.id)
      FROM chat_attachments a WHERE a.message_id = m.id), '[]'::json) attachments
  FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;

function tagsInput(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError("tags must be a list");
  const tags = [...new Set(value.map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase().replace(/^#/, "") : "")))].filter(Boolean);
  if (tags.length > MAX_TAGS) throw new ValidationError(`At most ${MAX_TAGS} tags`);
  for (const tag of tags) if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(tag)) throw new ValidationError("Tags may only use letters, numbers and dashes");
  return tags;
}

function messageInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected a JSON object");
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (body.length > 8000) throw new ValidationError("The message is too long");
  const attachmentIds = Array.isArray(value.attachmentIds) ? value.attachmentIds.map((id) => pathId(id, "attachmentId")) : [];
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new ValidationError(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
  if (!body && !attachmentIds.length) throw new ValidationError("Write a message or attach a file");
  return { body, tags: tagsInput(value.tags), attachmentIds };
}

// RFC 5987 so names with accents or spaces download correctly and cannot break the header.
function contentDisposition(kind, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function registerChatRoutes(app, pool, requireAdmin, hooks = {}) {
  app.get("/api/chat/messages", async (request) => {
    const after = Number(request.query?.after);
    if (Number.isSafeInteger(after) && after > 0) {
      return (await pool.query(`${messageSelect} WHERE m.id > $1 ORDER BY m.id LIMIT 200`, [after])).rows;
    }
    const before = Number(request.query?.before);
    const rows = Number.isSafeInteger(before) && before > 0
      ? (await pool.query(`${messageSelect} WHERE m.id < $1 ORDER BY m.id DESC LIMIT 100`, [before])).rows
      : (await pool.query(`${messageSelect} ORDER BY m.id DESC LIMIT 100`)).rows;
    return rows.reverse();
  });

  app.get("/api/chat/unread", async (request) => {
    const after = Number(request.query?.after);
    const result = await pool.query("SELECT COUNT(*)::integer count, COALESCE(MAX(id), 0)::bigint latest FROM chat_messages WHERE id > $1 AND user_id IS DISTINCT FROM $2",
      [Number.isSafeInteger(after) && after > 0 ? after : 0, request.user.id]);
    return result.rows[0];
  });

  // Files are sent as the raw request body; the name and type travel in headers.
  app.post("/api/chat/attachments", { bodyLimit: MAX_ATTACHMENT_BYTES }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length) return reply.code(400).send({ error: "Send the file as application/octet-stream" });
    let filename = "file";
    try { filename = decodeURIComponent(String(request.headers["x-filename"] ?? "file")); } catch { /* keep default */ }
    filename = filename.replace(/[\\/\r\n\0]/g, "_").trim().slice(0, 200) || "file";
    const contentType = String(request.headers["x-content-type"] ?? "").toLowerCase();
    const safeType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) ? contentType : "application/octet-stream";
    // Uploads never sent with a message are cleaned up after a day.
    await pool.query("DELETE FROM chat_attachments WHERE message_id IS NULL AND created_at < now() - interval '1 day'");
    const result = await pool.query(`INSERT INTO chat_attachments (uploaded_by, filename, content_type, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [request.user.id, filename, safeType, request.body.length, request.body]);
    return reply.code(201).send({ id: result.rows[0].id, filename, contentType: safeType, size: request.body.length });
  });

  app.get("/api/chat/attachments/:id", async (request, reply) => {
    const result = await pool.query("SELECT filename, content_type, data FROM chat_attachments WHERE id=$1 AND message_id IS NOT NULL", [pathId(request.params.id)]);
    if (!result.rowCount) return reply.code(404).send({ error: "Not found" });
    const file = result.rows[0];
    const inline = INLINE_TYPES.has(file.content_type) && request.query?.download !== "1";
    return reply
      .header("Content-Type", inline ? file.content_type : "application/octet-stream")
      .header("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", file.filename))
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox")
      .header("Cache-Control", "private, max-age=86400")
      .send(file.data);
  });

  app.post("/api/chat/messages", async (request, reply) => {
    const input = messageInput(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const author = request.user.display_name || request.user.username;
      const result = await client.query("INSERT INTO chat_messages (user_id, author_name, body, tags) VALUES ($1,$2,$3,$4) RETURNING id",
        [request.user.id, author, input.body, input.tags]);
      const id = result.rows[0].id;
      if (input.attachmentIds.length) {
        const attached = await client.query("UPDATE chat_attachments SET message_id=$1 WHERE id = ANY($2) AND message_id IS NULL AND uploaded_by=$3",
          [id, input.attachmentIds, request.user.id]);
        if (attached.rowCount !== input.attachmentIds.length) throw new ValidationError("An attachment is missing; upload it again");
      }
      await client.query("COMMIT");
      const message = await pool.query(`${messageSelect} WHERE m.id=$1`, [id]);
      hooks.onMessage?.(message.rows[0], request.user);
      return reply.code(201).send(message.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.put("/api/chat/messages/:id/resolved", async (request, reply) => {
    const result = await pool.query("UPDATE chat_messages SET resolved=$1 WHERE id=$2", [request.body?.resolved === true, pathId(request.params.id)]);
    if (!result.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // Authors can delete their own messages; admins can delete any.
  app.delete("/api/chat/messages/:id", async (request, reply) => {
    const id = pathId(request.params.id);
    const found = await pool.query("SELECT user_id FROM chat_messages WHERE id=$1", [id]);
    if (!found.rowCount) return reply.code(404).send({ error: "Not found" });
    if (found.rows[0].user_id !== request.user.id) requireAdmin(request);
    await pool.query("DELETE FROM chat_messages WHERE id=$1", [id]);
    return reply.code(204).send();
  });
}
