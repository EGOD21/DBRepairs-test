import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, invoiceInput, paymentInput, roundMinutes, signatureInput, timeInput } from "../src/billing.js";
import { diff } from "../src/audit.js";

test("invoice totals: line amounts, discount before tax, tax only on taxable lines", () => {
  const totals = computeTotals([
    { quantity: 1.5, unit_price: 80, taxable: true },
    { quantity: 2, unit_price: 49.99, taxable: true },
    { quantity: 1, unit_price: 20, taxable: false },
  ], 10, 20);
  assert.deepEqual(totals.lines.map((line) => line.amount), [120, 99.98, 20]);
  assert.equal(totals.subtotal, 239.98);
  assert.equal(totals.discount, 20);
  // Taxable share 219.98 of 239.98, minus its part of the discount, at 10%.
  assert.equal(totals.taxAmount, 20.16);
  assert.equal(totals.total, 240.14);
});

test("a discount never exceeds the subtotal", () => {
  const totals = computeTotals([{ quantity: 1, unit_price: 10, taxable: true }], 0, 50);
  assert.equal(totals.discount, 10);
  assert.equal(totals.total, 0);
});

test("timers round up to the billing step", () => {
  assert.equal(roundMinutes(1, 15), 15);
  assert.equal(roundMinutes(16, 15), 30);
  assert.equal(roundMinutes(7, 6), 12);
  assert.equal(roundMinutes(7, 1), 7);
  assert.equal(roundMinutes(0, 1), 1);
  assert.equal(roundMinutes(5000, 1), 1440);
  assert.equal(roundMinutes(7, 999), 7);
});

test("invoice input is validated", () => {
  const input = invoiceInput({ customer_id: 3, tax_rate: "8.25", lines: [{ description: " Labor ", quantity: "1.5", unit_price: "90", kind: "labor", time_entry_ids: [4, 4, "5"] }] });
  assert.equal(input.lines[0].description, "Labor");
  assert.deepEqual(input.lines[0].time_entry_ids, [4, 5]);
  assert.equal(input.tax_rate, 8.25);
  assert.throws(() => invoiceInput({ customer_id: 3, lines: [{ description: "" }] }), /description is required/);
  assert.throws(() => invoiceInput({ customer_id: 3, tax_rate: 150, lines: [] }), /tax_rate/);
  assert.throws(() => invoiceInput({ customer_id: 3, lines: [{ description: "x", kind: "bogus" }] }), /kind/);
});

test("payments, time and signatures are validated", () => {
  assert.equal(paymentInput({ amount: "10.005", method: "card" }).amount, 10.01);
  assert.throws(() => paymentInput({ amount: 0 }), /amount/);
  assert.throws(() => paymentInput({ amount: 5, method: "bitcoin" }), /method/);
  assert.throws(() => timeInput({ repair_id: 1 }), /minutes is required/);
  assert.throws(() => timeInput({ repair_id: 1, minutes: 2000 }), /minutes/);
  assert.equal(timeInput({ customer_id: 2, minutes: 30, billable: false }).billable, false);
  assert.throws(() => signatureInput({ name: "Ana", signature: "data:image/svg+xml;base64,AAAA" }), /signature/);
  assert.equal(signatureInput({ name: "Ana", signature: "data:image/png;base64,iVBORw0KGgo=" }).name, "Ana");
});

test("audit diffs list only changed fields", () => {
  assert.deepEqual(diff({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: "" }), { b: ["x", "y"] });
  assert.deepEqual(diff({ fee: 10 }, { fee: "10" }), {});
  assert.deepEqual(diff({ fee: null }, { fee: 0 }), { fee: [null, 0] });
});
