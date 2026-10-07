import { randomBytes } from "node:crypto";
import { audit } from "./audit.js";
import { parseAddress, sendMail } from "./smtp.js";
import { generateVapidKeys, sendPush } from "./webpush.js";
import { choice, id, object, pathId, text, ValidationError } from "./validation.js";

export function twilioConfig(env) {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM?.trim();
  return sid && token && from ? { sid, token, from } : null;
}

/** Sends a text message through Twilio's REST API. */
export async function sendSms(config, to, body) {
  if (!config) throw new Error("Text messages are not set up (TWILIO_*)");
  const number = String(to).replace(/[^\d+]/g, "");
  if (!/^\+?\d{6,15}$/.test(number)) throw new Error(`Not a phone number: ${to}`);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: number, From: config.from, Body: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try { detail = (await response.json()).message ?? detail; } catch { /* keep status */ }
    throw new Error(`The SMS service refused the message: ${detail}`);
  }
}

/** {name} style placeholders; unknown ones are left as they are. */
export const fillTemplate = (template, values) => template.replace(/\{(\w+)\}/g, (match, key) => (key in values && values[key] != null ? String(values[key]) : match));

export const DEFAULT_TEMPLATES = {
  received: {
    subject: "We received your {device} — repair {number}",
    body: "Hello {name},\n\nThanks for bringing in your {device}. Your repair number is {number}.{statusLine}\n\nWe will let you know as soon as it is ready.\n\n{company}",
    sms: "{company}: we received your {device} (repair {number}).{statusLine}",
  },
  ready: {
    subject: "Your {device} is ready for pickup — repair {number}",
    body: "Hello {name},\n\nGood news: your {device} (repair {number}) is ready for pickup.{balanceLine}{statusLine}\n\n{company}",
    sms: "{company}: your {device} (repair {number}) is ready for pickup.{balanceLine}",
  },
};

// Status words for the public page, in the languages the app ships with.
const STATUS_WORDS = {
  en: { RECEIVED: "Received", DIAGNOSIS: "Being diagnosed", WAITING_CUSTOMER: "Waiting for your reply", WAITING_PARTS: "Waiting for parts", IN_REPAIR: "Being repaired", REPAIRED: "Repaired, final checks", READY: "Ready for pickup", DELIVERED: "Collected", CANCELLED: "Cancelled",
    title: "Repair status", number: "Repair", device: "Device", updated: "Last update", due: "Expected", balance: "Balance due", history: "Progress", contact: "Questions? Contact us" },
  "pt-PT": { RECEIVED: "Recebido", DIAGNOSIS: "Em diagnóstico", WAITING_CUSTOMER: "A aguardar a sua resposta", WAITING_PARTS: "A aguardar peças", IN_REPAIR: "Em reparação", REPAIRED: "Reparado, verificações finais", READY: "Pronto para levantar", DELIVERED: "Entregue", CANCELLED: "Cancelado",
    title: "Estado da reparação", number: "Reparação", device: "Equipamento", updated: "Última atualização", due: "Previsão", balance: "Valor em dívida", history: "Progresso", contact: "Dúvidas? Contacte-nos" },
  es: { RECEIVED: "Recibido", DIAGNOSIS: "En diagnóstico", WAITING_CUSTOMER: "Esperando tu respuesta", WAITING_PARTS: "Esperando piezas", IN_REPAIR: "En reparación", REPAIRED: "Reparado, últimas comprobaciones", READY: "Listo para recoger", DELIVERED: "Entregado", CANCELLED: "Cancelado",
    title: "Estado de la reparación", number: "Reparación", device: "Equipo", updated: "Última actualización", due: "Previsto", balance: "Saldo pendiente", history: "Progreso", contact: "¿Preguntas? Contáctanos" },
  fr: { RECEIVED: "Reçu", DIAGNOSIS: "En diagnostic", WAITING_CUSTOMER: "En attente de votre réponse", WAITING_PARTS: "En attente de pièces", IN_REPAIR: "En réparation", REPAIRED: "Réparé, derniers contrôles", READY: "Prêt à récupérer", DELIVERED: "Récupéré", CANCELLED: "Annulé",
    title: "Suivi de réparation", number: "Réparation", device: "Appareil", updated: "Dernière mise à jour", due: "Prévu", balance: "Reste à payer", history: "Progression", contact: "Des questions ? Contactez-nous" },
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function messageInput(value) {
  const body = object(value);
  const channel = choice(body.channel, "channel", ["email", "sms"], "email");
  if (channel === "email" && typeof body.to === "string") {
    try { parseAddress(body.to); } catch (error) { throw new ValidationError(error.message); }
  }
  if (channel === "sms" && typeof body.to === "string" && !/^\+?\d{6,15}$/.test(body.to.replace(/[^\d+]/g, ""))) throw new ValidationError("to must be a phone number");
  return {
    channel,
    to: text(body.to, "to", { required: true, max: 300 }),
    subject: channel === "email" ? text(body.subject, "subject", { required: true, max: 300 }) : null,
    body: text(body.body, "body", { required: true, max: channel === "sms" ? 1600 : 20000 }),
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    customer_id: body.customer_id ? id(body.customer_id, "customer_id") : null,
    invoice_id: body.invoice_id ? id(body.invoice_id, "invoice_id") : null,
  };
}

export function createMessenger(pool, { smtp, sms, readSettings, log }) {
  // Pushes, keyed by user. VAPID keys are made once and kept in the database.
  async function vapid() {
    const row = (await pool.query("SELECT value FROM app_settings WHERE key='push.vapid'")).rows[0];
    if (row) return JSON.parse(row.value);
    const keys = generateVapidKeys();
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('push.vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(keys)]);
    return JSON.parse((await pool.query("SELECT value FROM app_settings WHERE key='push.vapid'")).rows[0].value);
  }

  async function pushToUsers(userIds, payload) {
    if (!userIds.length) return;
    const subscriptions = (await pool.query("SELECT * FROM push_subscriptions WHERE user_id = ANY($1)", [userIds])).rows;
    if (!subscriptions.length) return;
    const keys = await vapid();
    const settings = await readSettings(["office.email"]);
    const subject = `mailto:${settings["office.email"] || "admin@dbrepairs.invalid"}`;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        const result = await sendPush(subscription, payload, { ...keys, subject });
        if (result === "gone") await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [subscription.id]);
        else await pool.query("UPDATE push_subscriptions SET last_used_at=now() WHERE id=$1", [subscription.id]);
      } catch (error) {
        log?.warn?.({ err: error }, "Push notification failed");
      }
    }));
  }

  /** Fire-and-forget: notifications must never slow down or break a request. */
  const pushLater = (userIds, payload) => { void pushToUsers(userIds, payload).catch((error) => log?.warn?.({ err: error }, "Push failed")); };

  async function activeUserIds(exceptId) {
    return (await pool.query("SELECT id FROM users WHERE active AND id <> $1", [exceptId ?? 0])).rows.map((row) => row.id);
  }

  async function record(entry, status, error) {
    await pool.query(`INSERT INTO outbox (channel, recipient, subject, body, status, error, repair_id, customer_id, invoice_id, sent_by, automatic)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [entry.channel, entry.to, entry.subject ?? null, entry.body, status, error ?? null, entry.repair_id ?? null, entry.customer_id ?? null, entry.invoice_id ?? null,
      entry.userId ?? null, Boolean(entry.automatic)]);
  }

  /** Sends one email or SMS and keeps a copy in the outbox (also when it fails). */
  async function send(entry) {
    try {
      if (entry.channel === "email") {
        const settings = await readSettings(["office.email"]);
        await sendMail(smtp, { to: entry.to, subject: entry.subject, text: entry.body, replyTo: settings["office.email"] || undefined });
      } else {
        await sendSms(sms, entry.to, entry.body);
      }
      await record(entry, "sent");
    } catch (error) {
      await record(entry, "failed", error.message).catch(() => {});
      throw error;
    }
  }

  async function statusLink(repairId) {
    const settings = await readSettings(["status.enabled", "status.publicUrl"]);
    if (settings["status.enabled"] !== "1" || !settings["status.publicUrl"]) return null;
    let token = (await pool.query("SELECT status_token FROM repairs WHERE id=$1", [repairId])).rows[0]?.status_token;
    if (!token) {
      token = randomBytes(18).toString("base64url");
      await pool.query("UPDATE repairs SET status_token=$1 WHERE id=$2 AND status_token IS NULL", [token, repairId]);
      token = (await pool.query("SELECT status_token FROM repairs WHERE id=$1", [repairId])).rows[0].status_token;
    }
    return `${settings["status.publicUrl"].replace(/\/+$/, "")}/status/${token}`;
  }

  /** Automatic customer messages for "received" and "ready", if turned on in Settings. */
  async function notifyCustomer(event, repairId) {
    const settings = await readSettings([`notify.${event}`, `notify.${event}Subject`, `notify.${event}Body`, `notify.${event}Sms`, "office.companyName", "billing.currency"]);
    if (settings[`notify.${event}`] !== "1") return;
    const repair = (await pool.query(`SELECT r.id, r.repair_number, r.device_type, r.brand, r.model, r.customer_id, c.name, c.email, c.mobile, c.phone, c.preferred_contact,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.repair_id = r.id AND i.kind = 'invoice' AND i.status NOT IN ('void','draft')), 0)::float8
          - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.repair_id = r.id AND i.status <> 'void'), 0)::float8 balance
      FROM repairs r JOIN customers c ON c.id = r.customer_id WHERE r.id=$1`, [repairId])).rows[0];
    if (!repair) return;
    const link = await statusLink(repairId);
    const values = {
      name: repair.name.split(/\s+/)[0], customer: repair.name, number: repair.repair_number,
      device: [repair.brand, repair.model].filter(Boolean).join(" ") || repair.device_type || "device",
      company: settings["office.companyName"] || "DBRepairs",
      statusLine: link ? `\n\nTrack it here: ${link}` : "", statusLink: link ?? "",
      balanceLine: repair.balance > 0 ? `\n\nBalance due: ${repair.balance.toFixed(2)}${settings["billing.currency"] ? ` ${settings["billing.currency"]}` : ""}` : "",
    };
    const wantsSms = repair.preferred_contact === "sms" && repair.mobile && sms;
    const entry = { repair_id: repair.id, customer_id: repair.customer_id, automatic: true };
    if (wantsSms) {
      await send({ ...entry, channel: "sms", to: repair.mobile, body: fillTemplate(settings[`notify.${event}Sms`] || DEFAULT_TEMPLATES[event].sms, values).slice(0, 1600) });
    } else if (repair.email && smtp) {
      await send({ ...entry, channel: "email", to: repair.email,
        subject: fillTemplate(settings[`notify.${event}Subject`] || DEFAULT_TEMPLATES[event].subject, values),
        body: fillTemplate(settings[`notify.${event}Body`] || DEFAULT_TEMPLATES[event].body, values) });
    } else if (repair.mobile && sms) {
      await send({ ...entry, channel: "sms", to: repair.mobile, body: fillTemplate(settings[`notify.${event}Sms`] || DEFAULT_TEMPLATES[event].sms, values).slice(0, 1600) });
    }
  }
  const notifyCustomerLater = (event, repairId) => { void notifyCustomer(event, repairId).catch((error) => log?.warn?.({ err: error, repairId }, "Customer notification failed")); };

  return { send, pushToUsers, pushLater, activeUserIds, statusLink, notifyCustomer, notifyCustomerLater, vapid };
}

export function registerMessagingRoutes(app, pool, { messenger, smtp, sms, requireAdmin, readSettings }) {
  const sentRecently = new Map();
  const limit = (userId) => {
    // At most 60 messages a minute per person, so a stuck button cannot spam customers.
    const now = Date.now();
    const recent = (sentRecently.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= 60) throw Object.assign(new Error("Too many messages. Wait a minute"), { statusCode: 429 });
    recent.push(now);
    sentRecently.set(userId, recent);
  };

  app.get("/api/messaging/status", async () => ({ email: Boolean(smtp), sms: Boolean(sms), push: true }));

  app.get("/api/messages", async (request) => {
    const q = request.query ?? {};
    if (q.repairId) return (await pool.query("SELECT o.*, u.display_name sent_by_name FROM outbox o LEFT JOIN users u ON u.id = o.sent_by WHERE o.repair_id=$1 ORDER BY o.id DESC LIMIT 100", [pathId(q.repairId, "repairId")])).rows;
    if (q.customerId) return (await pool.query("SELECT o.*, u.display_name sent_by_name FROM outbox o LEFT JOIN users u ON u.id = o.sent_by WHERE o.customer_id=$1 ORDER BY o.id DESC LIMIT 100", [pathId(q.customerId, "customerId")])).rows;
    requireAdmin(request);
    return (await pool.query("SELECT o.*, u.display_name sent_by_name FROM outbox o LEFT JOIN users u ON u.id = o.sent_by ORDER BY o.id DESC LIMIT 200")).rows;
  });

  app.post("/api/messages", async (request, reply) => {
    const input = messageInput(request.body);
    if (input.channel === "email" && !smtp) throw Object.assign(new Error("Email sending is not set up on the server"), { statusCode: 503 });
    if (input.channel === "sms" && !sms) throw Object.assign(new Error("Text messages are not set up on the server"), { statusCode: 503 });
    limit(request.user.id);
    try {
      await messenger.send({ ...input, userId: request.user.id });
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 502 });
    }
    await audit(pool, request, { action: "send", entity: input.channel, repairId: input.repair_id, customerId: input.customer_id,
      summary: `${input.channel === "email" ? "Email" : "Text"} sent to ${input.to}${input.subject ? `: ${input.subject}` : ""}` });
    return reply.code(201).send({ ok: true });
  });

  // Push notifications for the team's phones and computers.
  app.get("/api/push/key", async () => ({ publicKey: (await messenger.vapid()).publicKey }));

  app.post("/api/push/subscriptions", async (request, reply) => {
    const body = object(request.body);
    const endpoint = text(body.endpoint, "endpoint", { required: true, max: 2000 });
    let url;
    try { url = new URL(endpoint); } catch { throw new ValidationError("endpoint must be a URL"); }
    if (url.protocol !== "https:") throw new ValidationError("endpoint must use https");
    const p256dh = text(body.keys?.p256dh, "p256dh", { required: true, max: 200 });
    const auth = text(body.keys?.auth, "auth", { required: true, max: 100 });
    if (Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(auth, "base64url").length !== 16) throw new ValidationError("Invalid subscription keys");
    await pool.query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent`,
    [request.user.id, endpoint, p256dh, auth, String(request.headers["user-agent"] ?? "").slice(0, 300)]);
    return reply.code(204).send();
  });

  app.delete("/api/push/subscriptions", async (request, reply) => {
    const endpoint = text(request.body?.endpoint, "endpoint", { required: true, max: 2000 });
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2", [endpoint, request.user.id]);
    return reply.code(204).send();
  });

  app.post("/api/push/test", async (request) => {
    const count = (await pool.query("SELECT COUNT(*)::integer n FROM push_subscriptions WHERE user_id=$1", [request.user.id])).rows[0].n;
    if (!count) throw new ValidationError("This account has no devices with notifications turned on");
    await messenger.pushToUsers([request.user.id], { title: "DBRepairs", body: "Notifications are working.", url: "/" });
    return { devices: count };
  });

  // ---------- Customer status page ----------
  app.get("/api/repairs/:id/status-link", async (request) => {
    const repairId = pathId(request.params.id);
    return { url: await messenger.statusLink(repairId) };
  });

  // Public: the token in the link is the only key, and it shows just the basics.
  app.get("/status/:token", async (request, reply) => {
    const settings = await readSettings(["status.enabled", "status.language", "office.companyName", "office.logoDataUrl", "office.phone", "office.email", "office.website", "office.address", "billing.currency"]);
    const token = request.params.token;
    if (settings["status.enabled"] !== "1" || !/^[A-Za-z0-9_-]{24}$/.test(token)) return reply.code(404).type("text/plain").send("Not found");
    const repair = (await pool.query(`SELECT r.id, r.repair_number, r.device_type, r.brand, r.model, r.due_date, r.updated_at, r.opened_at, s.code status_code,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.repair_id = r.id AND i.kind='invoice' AND i.status NOT IN ('void','draft')), 0)::float8 invoiced,
        COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.repair_id = r.id AND i.status <> 'void'), 0)::float8 paid
      FROM repairs r JOIN repair_statuses s ON s.id = r.status_id WHERE r.status_token=$1`, [token])).rows[0];
    if (!repair) return reply.code(404).type("text/plain").send("Not found");
    const history = (await pool.query(`SELECT s.code, h.changed_at FROM repair_status_history h JOIN repair_statuses s ON s.id = h.status_id
      WHERE h.repair_id=$1 ORDER BY h.id`, [repair.id])).rows;
    const words = STATUS_WORDS[settings["status.language"]] ?? STATUS_WORDS.en;
    const date = (value) => new Date(value).toLocaleDateString(settings["status.language"] || "en", { day: "numeric", month: "short", year: "numeric" });
    const balance = Math.max(0, repair.invoiced - repair.paid);
    const company = settings["office.companyName"] || "DBRepairs";
    const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(settings["office.logoDataUrl"]) ? settings["office.logoDataUrl"] : "";
    const contact = [settings["office.phone"], settings["office.email"], settings["office.website"]].filter(Boolean);
    const device = [repair.brand, repair.model].filter(Boolean).join(" ") || repair.device_type || "";
    const html = `<!doctype html><html lang="${escapeHtml(settings["status.language"] || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(words.title)} · ${escapeHtml(repair.repair_number)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f8fa;color:#1f2937}main{max-width:560px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;gap:12px;margin-bottom:20px}header img{width:48px;height:48px;object-fit:contain;border-radius:10px;background:#fff}
h1{font-size:20px;margin:0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin-bottom:14px}
.status{font-size:22px;font-weight:700;margin:4px 0 0}.label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}dd{margin:0}ol{margin:0;padding-left:18px;display:grid;gap:6px}li span{color:#6b7280;font-size:13px}
.ready{color:#15803d}.balance{font-weight:700}footer{color:#6b7280;font-size:13px;text-align:center}</style></head>
<body><main><header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${escapeHtml(company)}</h1><div class="label">${escapeHtml(words.title)}</div></div></header>
<section class="card"><div class="label">${escapeHtml(words.number)} ${escapeHtml(repair.repair_number)}</div><p class="status${repair.status_code === "READY" ? " ready" : ""}">${escapeHtml(words[repair.status_code] ?? repair.status_code)}</p></section>
<section class="card"><dl>${device ? `<dt class="label">${escapeHtml(words.device)}</dt><dd>${escapeHtml(device)}</dd>` : ""}
${repair.due_date && !["DELIVERED", "CANCELLED", "READY"].includes(repair.status_code) ? `<dt class="label">${escapeHtml(words.due)}</dt><dd>${escapeHtml(date(repair.due_date))}</dd>` : ""}
<dt class="label">${escapeHtml(words.updated)}</dt><dd>${escapeHtml(date(repair.updated_at ?? repair.opened_at))}</dd>
${balance > 0 ? `<dt class="label">${escapeHtml(words.balance)}</dt><dd class="balance">${escapeHtml(balance.toFixed(2))}${settings["billing.currency"] ? ` ${escapeHtml(settings["billing.currency"])}` : ""}</dd>` : ""}</dl></section>
<section class="card"><div class="label">${escapeHtml(words.history)}</div><ol>${history.map((h) => `<li>${escapeHtml(words[h.code] ?? h.code)} <span>${escapeHtml(date(h.changed_at))}</span></li>`).join("")}</ol></section>
${contact.length ? `<footer>${escapeHtml(words.contact)}<br>${contact.map(escapeHtml).join(" · ")}</footer>` : ""}</main></body></html>`;
    return reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store")
      .header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .header("X-Robots-Tag", "noindex").send(html);
  });
}

/** Every 5 minutes: warn the team about contract repairs close to their response deadline. */
export function startNotifier(pool, messenger, log) {
  const run = async () => {
    try {
      const due = (await pool.query(`UPDATE repairs r SET sla_warned_at = now() FROM customers c
        WHERE c.id = r.customer_id AND r.sla_due_at IS NOT NULL AND r.first_response_at IS NULL AND r.sla_warned_at IS NULL
          AND r.sla_due_at < now() + interval '1 hour'
          AND r.status_id NOT IN (SELECT id FROM repair_statuses WHERE code IN ('DELIVERED','CANCELLED'))
        RETURNING r.id, r.repair_number, c.name customer_name, r.sla_due_at`)).rows;
      if (!due.length) return;
      const users = await messenger.activeUserIds(null);
      for (const repair of due) {
        await messenger.pushToUsers(users, { title: `Respond to ${repair.repair_number}`, body: `${repair.customer_name}: response due ${new Date(repair.sla_due_at).toLocaleTimeString()}`, url: `/#/repairs/${repair.id}`, tag: `sla-${repair.id}` });
      }
    } catch (error) {
      log.warn({ err: error }, "Response-time warnings failed");
    }
  };
  const timer = setInterval(run, 5 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
