import test from "node:test";
import assert from "node:assert/strict";
import { adjustInput, appointmentInput, returnInput, stockInput, toIcs } from "../src/shopfloor.js";

test("stock and returns are validated", () => {
  assert.equal(stockInput({ name: "Samsung 870 EVO 1TB", price: "89.99", reorder_level: "2" }).reorder_level, 2);
  assert.throws(() => stockInput({ name: "" }), /name is required/);
  assert.throws(() => stockInput({ name: "x", cost: -1 }), /cost/);
  assert.deepEqual(adjustInput({ change: "5" }), { change: 5, reason: "received", note: null });
  assert.equal(adjustInput({ change: -1 }).reason, "adjusted");
  assert.throws(() => adjustInput({ change: 0 }), /change/);
  assert.throws(() => adjustInput({ change: 1.5 }), /change/);
  assert.throws(() => returnInput({ supplier: "Ingram", item: "PSU", status: "lost" }), /status/);
});

test("appointments need a valid time range", () => {
  const a = appointmentInput({ title: "Server swap", starts_at: "2026-10-08T09:00:00Z", ends_at: "2026-10-08T11:00:00Z" });
  assert.equal(a.kind, "onsite");
  assert.throws(() => appointmentInput({ title: "x", starts_at: "2026-10-08T11:00:00Z", ends_at: "2026-10-08T09:00:00Z" }), /end must be after/);
  assert.throws(() => appointmentInput({ title: "x", starts_at: "soon", ends_at: "later" }), /dates/);
  assert.throws(() => appointmentInput({ title: "x", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" }), /14 days/);
});

test("calendar feeds are valid iCalendar", () => {
  const ics = toIcs([
    { id: 7, title: "Firewall install; phase 2", customer_name: "Acme, Inc.", starts_at: "2026-10-08T09:00:00.000Z", ends_at: "2026-10-08T11:30:00.000Z",
      all_day: false, address: "1 Main St\nSuite 4", notes: "Bring console cable — " + "x".repeat(120), status: "scheduled", created_at: "2026-10-01T00:00:00Z" },
    { id: 8, title: "Pickup", starts_at: "2026-10-09T00:00:00.000Z", ends_at: "2026-10-09T00:00:00.000Z", all_day: true, status: "cancelled" },
  ], "Shop — Sam");
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("DTSTART:20261008T090000Z"));
  assert.ok(lines.includes("DTEND:20261008T113000Z"));
  assert.ok(lines.includes("SUMMARY:Firewall install\\; phase 2 — Acme\\, Inc."));
  assert.ok(lines.includes("LOCATION:1 Main St\\nSuite 4"));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261009") && lines.includes("DTEND;VALUE=DATE:20261010"));
  assert.ok(lines.includes("STATUS:CANCELLED"));
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 75), "lines are folded");
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});
