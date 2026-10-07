import test from "node:test";
import assert from "node:assert/strict";
import { advanceDate, contractInput, periodInput, periodRange, planInput, usageSplit } from "../src/contracts.js";
import { csvCell, toCsv } from "../src/reports.js";

test("maintenance dates advance by their frequency and clamp to month ends", () => {
  assert.equal(advanceDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceDate("2028-01-31", "monthly"), "2028-02-29");
  assert.equal(advanceDate("2026-11-15", "quarterly"), "2027-02-15");
  assert.equal(advanceDate("2026-12-28", "weekly"), "2027-01-04");
  assert.equal(advanceDate("2026-03-10", "yearly"), "2027-03-10");
  assert.equal(advanceDate("2026-03-10", "monthly", 2), "2026-05-10");
});

test("periods cover a whole month", () => {
  assert.deepEqual(periodRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  assert.throws(() => periodInput("2026-13"), /period/);
  assert.throws(() => periodInput("2026-1"), /period/);
});

test("contract hours split into included and overage", () => {
  assert.deepEqual(usageSplit(690, 10), { usedHours: 11.5, includedHours: 10, overageHours: 1.5, percent: 115 });
  assert.deepEqual(usageSplit(60, 0), { usedHours: 1, includedHours: 0, overageHours: 1, percent: null });
});

test("contracts and plans are validated", () => {
  const contract = contractInput({ customer_id: 1, name: "Server care", monthly_fee: "300", hours_included: "4.5", response_hours: "4" });
  assert.equal(contract.hours_included, 4.5);
  assert.equal(contract.billing_day, 1);
  assert.throws(() => contractInput({ customer_id: 1, name: "x", billing_day: 31 }), /billing_day/);
  assert.throws(() => contractInput({ customer_id: 1, name: "" }), /name is required/);
  assert.throws(() => planInput({ customer_id: 1, title: "Patch", frequency: "daily", next_due: "2026-10-01" }), /frequency/);
  assert.throws(() => planInput({ customer_id: 1, title: "Patch" }), /next_due/);
});

test("CSV cells are quoted and formulas are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
  assert.equal(csvCell(-5), "-5");
  assert.equal(toCsv(["a", "b"], [[1, null]]), "a,b\r\n1,\r\n");
});
