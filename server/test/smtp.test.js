import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMessage, dotStuff, parseAddress, sendMail, smtpConfig } from "../src/smtp.js";

/** A tiny fake mail server that records what it receives. */
function fakeServer({ starttls = null, authMechanisms = "PLAIN LOGIN" } = {}) {
  const received = { commands: [], data: "" };
  const server = net.createServer((raw) => {
    let socket = raw;
    let buffer = "";
    let inData = false;
    const send = (line) => socket.write(`${line}\r\n`);
    const onData = (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; send("250 Queued"); } else received.data += `${line}\n`;
          continue;
        }
        received.commands.push(line);
        if (/^EHLO/.test(line)) { send("250-fake.test"); if (starttls && socket === raw) send("250-STARTTLS"); send(`250 AUTH ${authMechanisms}`); }
        else if (line === "STARTTLS") {
          send("220 Go ahead");
          raw.off("data", onData);
          socket = new tls.TLSSocket(raw, { isServer: true, key: starttls.key, cert: starttls.cert });
          socket.on("data", onData);
        }
        else if (/^AUTH PLAIN /.test(line)) send(Buffer.from(line.slice(11), "base64").toString() === "\0sam@shop.test\0secret" ? "235 OK" : "535 Bad");
        else if (line === "AUTH LOGIN") send("334 VXNlcm5hbWU6");
        else if (/^MAIL FROM|^RCPT TO/.test(line)) send("250 OK");
        else if (line === "DATA") { inData = true; send("354 Go"); }
        else if (line === "QUIT") { send("221 Bye"); socket.end(); }
        else if (received.commands.at(-2) === "AUTH LOGIN") send("334 UGFzc3dvcmQ6");
        else if (received.commands.at(-3) === "AUTH LOGIN") send(Buffer.from(line, "base64").toString() === "secret" ? "235 OK" : "535 Bad");
        else send("500 What");
      }
    };
    raw.on("data", onData);
    send("220 fake.test ESMTP");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, received })));
}

test("addresses and headers cannot be used to inject headers", () => {
  assert.deepEqual(parseAddress("Fix-It <shop@example.com>"), { name: "Fix-It", address: "shop@example.com" });
  assert.throws(() => parseAddress("a@b.com\r\nBcc: x@y.com"), /line breaks/);
  assert.throws(() => parseAddress("not an address"), /Not an email/);
  assert.throws(() => buildMessage({ from: "a@b.com", to: ["c@d.com"], subject: "Hi\r\nBcc: e@f.com", text: "x" }), /line breaks/);
  const message = buildMessage({ from: "Fix-It <a@b.com>", to: ["c@d.com"], subject: "Réparation prête", text: "Olá\n.\nEnd" });
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(dotStuff("a\n.\nb"), /\r\n\.\.\r\n/);
});

test("config picks TLS mode from the port", () => {
  assert.equal(smtpConfig({}), null);
  assert.equal(smtpConfig({ SMTP_HOST: "smtp.x", SMTP_PORT: "465" }).security, "tls");
  assert.equal(smtpConfig({ SMTP_HOST: "smtp.x" }).security, "starttls");
  assert.equal(smtpConfig({ SMTP_HOST: "smtp.x", SMTP_PORT: "25" }).security, "none");
});

test("sends through a plain server with AUTH PLAIN", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  await sendMail({ host: "127.0.0.1", port: fake.port, security: "none", user: "sam@shop.test", password: "secret", from: "Shop <sam@shop.test>", timeoutMs: 3000 },
    { to: "jo@example.com", subject: "Ready", text: "Your laptop is ready.\n.\nBye", replyTo: "front@shop.test" });
  assert.ok(fake.received.commands.includes("MAIL FROM:<sam@shop.test>"));
  assert.ok(fake.received.commands.includes("RCPT TO:<jo@example.com>"));
  assert.match(fake.received.data, /Reply-To: front@shop.test/);
  const textPart = /Content-Type: text\/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n([A-Za-z0-9+/=\n]+)\n--/.exec(fake.received.data);
  assert.equal(Buffer.from(textPart[1].replace(/\n/g, ""), "base64").toString(), "Your laptop is ready.\n.\nBye");
});

test("upgrades with STARTTLS and falls back to AUTH LOGIN", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "smtp-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const fake = await fakeServer({ starttls: { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, authMechanisms: "LOGIN" });
  t.after(() => fake.server.close());
  await sendMail({ host: "127.0.0.1", port: fake.port, security: "starttls", user: "sam@shop.test", password: "secret", from: "sam@shop.test", timeoutMs: 3000, rejectUnauthorized: false },
    { to: ["a@example.com", "b@example.com"], subject: "Hi", text: "Hello" });
  assert.ok(fake.received.commands.includes("STARTTLS"));
  assert.equal(fake.received.commands.filter((c) => c.startsWith("EHLO")).length, 2);
  assert.ok(fake.received.commands.includes("AUTH LOGIN"));
  assert.equal(fake.received.commands.filter((c) => c.startsWith("RCPT TO")).length, 2);
});

test("a refused login is reported", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  await assert.rejects(sendMail({ host: "127.0.0.1", port: fake.port, security: "none", user: "sam@shop.test", password: "wrong", from: "sam@shop.test", timeoutMs: 3000 },
    { to: "jo@example.com", subject: "x", text: "y" }), /refused AUTH: 535/);
});
