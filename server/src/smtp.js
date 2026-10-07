import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import os from "node:os";

/**
 * A small SMTP client (no extra packages): implicit TLS (port 465) or
 * STARTTLS (587), AUTH PLAIN/LOGIN, and a text + HTML message.
 */
export function smtpConfig(env) {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const security = ["tls", "starttls", "none"].includes(env.SMTP_SECURITY) ? env.SMTP_SECURITY : port === 465 ? "tls" : port === 25 ? "none" : "starttls";
  return {
    host, port, security,
    user: env.SMTP_USER?.trim() || "",
    password: env.SMTP_PASSWORD ?? "",
    from: env.SMTP_FROM?.trim() || env.SMTP_USER?.trim() || "",
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    timeoutMs: 20_000,
  };
}

const CRLF = "\r\n";
const noBreaks = (value, field) => {
  if (/[\r\n]/.test(String(value))) throw new Error(`${field} cannot contain line breaks`);
  return String(value);
};

/** Pulls "Name <addr@x>" or "addr@x" apart and checks the address. */
export function parseAddress(value) {
  const text = noBreaks(value, "Address").trim();
  const match = /^(?:"?([^"<]*)"?\s*)?<([^<>\s@]+@[^<>\s@]+)>$/.exec(text) ?? /^()([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/.exec(text);
  if (!match) throw new Error(`Not an email address: ${text}`);
  return { name: match[1]?.trim() || "", address: match[2] };
}

function encodeWord(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
const formatAddress = ({ name, address }) => (name ? `${/^[\w .-]*$/.test(name) ? name : encodeWord(name)} <${address}>` : address);
const base64Lines = (text) => Buffer.from(text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Builds the full RFC 5322 message. */
export function buildMessage({ from, to, replyTo, subject, text, date = new Date(), messageId }) {
  const boundary = `dbr-${randomUUID()}`;
  const fromAddress = parseAddress(from);
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</body></html>`;
  const headers = [
    `From: ${formatAddress(fromAddress)}`,
    `To: ${to.map((address) => formatAddress(parseAddress(address))).join(", ")}`,
    ...(replyTo ? [`Reply-To: ${formatAddress(parseAddress(replyTo))}`] : []),
    `Subject: ${encodeWord(noBreaks(subject, "Subject"))}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId ?? randomUUID()}@${fromAddress.address.split("@")[1]}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(text),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(html),
    `--${boundary}--`, "",
  ].join(CRLF);
}

/** Lines starting with "." get an extra "." so they cannot end the message early. */
export const dotStuff = (message) => message.replace(/\r?\n/g, CRLF).replace(/^\./gm, "..");

class Connection {
  constructor(socket, timeoutMs) {
    this.buffer = "";
    this.waiting = null;
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    // Buffers, not setEncoding: STARTTLS later hands this same socket to TLS, which needs raw bytes.
    this.onData = (chunk) => { this.buffer += chunk.toString("utf8"); this.flush(); };
    this.onError = (error) => this.fail(error);
    this.onClose = () => this.fail(new Error("The mail server closed the connection"));
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }
  detach() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }
  fail(error) {
    if (this.waiting) { const { reject } = this.waiting; this.waiting = null; reject(error); }
  }
  flush() {
    if (!this.waiting) return;
    // A reply ends with a line "250 text" (a dash after the code means more lines follow).
    const lines = this.buffer.split(CRLF);
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const reply = lines.slice(0, i + 1);
        this.buffer = lines.slice(i + 1).join(CRLF);
        const { resolve, timer } = this.waiting;
        clearTimeout(timer);
        this.waiting = null;
        resolve({ code: Number(reply[i].slice(0, 3)), lines: reply.map((line) => line.slice(4)) });
        return;
      }
    }
  }
  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("The mail server did not answer in time")), this.timeoutMs);
      this.waiting = { resolve, reject, timer };
      this.flush();
    });
  }
  async command(line, expect, label) {
    if (line !== null) this.socket.write(`${line}${CRLF}`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      // Never repeat credentials (or their base64) in error messages.
      const shown = label ?? (line?.startsWith("AUTH") ? "AUTH" : line?.split(" ")[0] ?? "connect");
      throw new Error(`Mail server refused ${shown}: ${reply.code} ${reply.lines.join(" ")}`.trim());
    }
    return reply;
  }
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port, servername: config.host, rejectUnauthorized: config.rejectUnauthorized };
    const socket = config.security === "tls" ? tls.connect(options) : net.connect(options);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Could not reach the mail server")); }, config.timeoutMs);
    socket.once(config.security === "tls" ? "secureConnect" : "connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function sendMail(config, { to, subject, text, replyTo }) {
  if (!config) throw new Error("Email sending is not set up (SMTP_HOST)");
  const recipients = (Array.isArray(to) ? to : [to]).map((address) => parseAddress(address).address);
  const message = buildMessage({ from: config.from, to: recipients, replyTo, subject, text });
  const socket = await connect(config);
  const smtp = new Connection(socket, config.timeoutMs);
  const helloName = os.hostname().replace(/[^A-Za-z0-9.-]/g, "") || "dbrepairs";
  try {
    await smtp.command(null, [220]);
    let hello = await smtp.command(`EHLO ${helloName}`, [250]);
    if (config.security === "starttls") {
      await smtp.command("STARTTLS", [220]);
      smtp.detach();
      const secure = tls.connect({ socket, servername: config.host, rejectUnauthorized: config.rejectUnauthorized });
      await new Promise((resolve, reject) => { secure.once("secureConnect", resolve); secure.once("error", reject); });
      smtp.attach(secure);
      hello = await smtp.command(`EHLO ${helloName}`, [250]);
    }
    if (config.user) {
      const auth = hello.lines.find((line) => /^AUTH\b/i.test(line)) ?? "";
      if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
        await smtp.command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.password}`).toString("base64")}`, [235]);
      } else {
        await smtp.command("AUTH LOGIN", [334]);
        await smtp.command(Buffer.from(config.user).toString("base64"), [334], "AUTH");
        await smtp.command(Buffer.from(config.password).toString("base64"), [235], "AUTH");
      }
    }
    await smtp.command(`MAIL FROM:<${parseAddress(config.from).address}>`, [250]);
    for (const recipient of recipients) await smtp.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await smtp.command("DATA", [354]);
    await smtp.command(`${dotStuff(message)}${CRLF}.`, [250], "the message");
    await smtp.command("QUIT", [221]).catch(() => {});
  } finally {
    smtp.socket.destroy();
  }
}
