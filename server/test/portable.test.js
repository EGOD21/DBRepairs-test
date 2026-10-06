import test from "node:test";
import assert from "node:assert/strict";
import { PortableBackupError, validatePortableBackup } from "../src/portable.js";

const empty = { format:"dbrepairs-portable",version:1,createdAt:"2026-08-21T12:00:00.000Z",sourceEngine:"sqlite",data:{settings:[],statuses:[{id:1,code:"RECEIVED",label_key:"status.received",sort_order:10,active:true}],customers:[],repairs:[],history:[]} };

test("portable backup accepts a valid empty archive", () => {
  assert.equal(validatePortableBackup(empty).sourceEngine, "sqlite");
});

test("portable backup rejects unsupported versions", () => {
  assert.throws(() => validatePortableBackup({ ...empty, version: 99 }), PortableBackupError);
});

test("portable backup rejects broken relationships", () => {
  const archive = structuredClone(empty);
  archive.data.repairs.push({id:1,repair_number:"2026-000001",customer_id:1,status_id:1,device_type:null,brand:null,model:null,serial_number:null,imei:null,reported_fault:null,accessories:null,general_condition:null,diagnosis:null,work_performed:null,estimated_value:null,final_value:null,internal_notes:null,opened_at:"2026-08-21T12:00:00Z",closed_at:null,created_at:"2026-08-21T12:00:00Z",updated_at:"2026-08-21T12:00:00Z"});
  assert.throws(() => validatePortableBackup(archive), /missing customer or status/);
});

test("portable backup marks SQLite timestamps without a time zone as UTC", () => {
  const archive = structuredClone(empty);
  archive.data.customers.push({id:1,name:"Ana",company:null,tax_number:null,phone:null,email:null,address:null,notes:null,created_at:"2026-08-21 12:00:00",updated_at:"2026-08-21T12:00:00+01:00"});
  const [customer] = validatePortableBackup(archive).data.customers;
  assert.equal(customer.created_at, "2026-08-21T12:00:00Z");
  assert.equal(customer.updated_at, "2026-08-21T12:00:00+01:00");
});

test("version 1 archives still import, with defaults for the newer fields", () => {
  const archive = structuredClone(empty);
  archive.data.customers.push({id:1,name:"Ana",company:null,tax_number:null,phone:null,email:null,address:null,notes:null,created_at:"2026-08-21 12:00:00",updated_at:"2026-08-21 12:00:00"});
  const result = validatePortableBackup(archive);
  assert.equal(result.data.customers[0].customer_type, "residential");
  assert.equal(result.data.customers[0].is_retainer, false);
  assert.deepEqual(result.data.parts, []);
});

test("portable backup rejects part links that are not web addresses", () => {
  const archive = structuredClone(empty);
  archive.version = 2;
  archive.data.customers.push({id:1,name:"Ana",company:null,tax_number:null,phone:null,email:null,address:null,notes:null,created_at:"2026-08-21T12:00:00Z",updated_at:"2026-08-21T12:00:00Z"});
  archive.data.repairs.push({id:1,repair_number:"2026-000001",customer_id:1,status_id:1,device_type:null,brand:null,model:null,serial_number:null,imei:null,reported_fault:null,accessories:null,general_condition:null,diagnosis:null,work_performed:null,estimated_value:null,final_value:null,internal_notes:null,opened_at:"2026-08-21T12:00:00Z",closed_at:null,created_at:"2026-08-21T12:00:00Z",updated_at:"2026-08-21T12:00:00Z"});
  archive.data.parts = [{id:1,repair_id:1,name:"Screen",part_number:null,supplier:null,url:"javascript:alert(1)",quantity:1,unit_cost:null,status:"needed",notes:null,ordered_at:null,received_at:null,created_at:"2026-08-21T12:00:00Z",updated_at:"2026-08-21T12:00:00Z"}];
  assert.throws(() => validatePortableBackup(archive), /web addresses|http/);
});
