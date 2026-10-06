import test from "node:test";
import assert from "node:assert/strict";
import { customerInput, partInput, repairInput, settingsInput, ValidationError } from "../src/validation.js";

test("customer input trims values and converts empty fields to null", () => {
  const customer = customerInput({ name: "  Ana  ", company: " " });
  assert.equal(customer.name, "Ana");
  assert.equal(customer.company, null);
  assert.equal(customer.customerType, "residential");
  assert.equal(customer.isRetainer, false);
});

test("customer name is required", () => {
  assert.throws(() => customerInput({ name: " " }), ValidationError);
});

test("retainer details are kept only for retainer customers", () => {
  const retainer = customerInput({ name: "Acme", customerType: "commercial", isRetainer: true, retainerPlan: "Gold", retainerMonthlyFee: "250", retainerRenewalDate: "2027-01-31" });
  assert.equal(retainer.retainerMonthlyFee, 250);
  assert.equal(retainer.retainerRenewalDate, "2027-01-31");
  assert.equal(customerInput({ name: "Bo", isRetainer: false, retainerPlan: "Gold" }).retainerPlan, null);
  assert.throws(() => customerInput({ name: "Bo", customerType: "alien" }), ValidationError);
  assert.throws(() => customerInput({ name: "Bo", isRetainer: true, retainerRenewalDate: "31/01/2027" }), ValidationError);
});

test("repair input validates identifiers, values, priority and dates", () => {
  assert.throws(() => repairInput({ customer_id: 0, status_id: 1, reported_fault: "screen" }), ValidationError);
  assert.throws(() => repairInput({ customer_id: 1, status_id: 1, reported_fault: "screen", estimated_value: -1 }), ValidationError);
  assert.throws(() => repairInput({ customer_id: 1, status_id: 1, reported_fault: "screen", priority: "asap" }), ValidationError);
  assert.throws(() => repairInput({ customer_id: 1, status_id: 1, reported_fault: "screen", due_date: "tomorrow" }), ValidationError);
  const repair = repairInput({ customer_id: 1, status_id: 2, reported_fault: " screen ", estimated_value: "12.50", warranty_days: "90", paid: true });
  assert.equal(repair.estimated_value, 12.5);
  assert.equal(repair.priority, "normal");
  assert.equal(repair.warranty_days, 90);
  assert.equal(repair.paid, true);
});

test("part links must be web addresses", () => {
  assert.equal(partInput({ name: "Battery", url: "https://example.com/battery" }).url, "https://example.com/battery");
  assert.equal(partInput({ name: "Battery" }).quantity, 1);
  assert.throws(() => partInput({ name: "Battery", url: "javascript:alert(1)" }), ValidationError);
  assert.throws(() => partInput({ name: "Battery", status: "lost" }), ValidationError);
});

test("settings accept known keys and safe values only", () => {
  assert.deepEqual(settingsInput({ "office.companyName": " Fix-It " }), { "office.companyName": "Fix-It" });
  assert.throws(() => settingsInput({ "unknown.key": "x" }), ValidationError);
  assert.throws(() => settingsInput({ "office.logoDataUrl": "https://evil.example/logo.png" }), ValidationError);
  assert.throws(() => settingsInput({ "ui.theme": '{"primary":"red;}body{display:none"}' }), ValidationError);
  assert.doesNotThrow(() => settingsInput({ "ui.theme": '{"primary":"#ff7a59","fontFamily":"\\"Inter\\", system-ui"}' }));
});
