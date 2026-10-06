const FORMAT = "dbrepairs-portable";
const VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2];

export class PortableBackupError extends Error {}

// Fields added in version 2 are missing from version 1 archives; use their defaults.
function optional(value, fallback, check) {
  return value === undefined ? fallback : check(value);
}

function oneOf(value, name, options) {
  if (!options.includes(value)) throw new PortableBackupError(`${name} must be one of ${options.join(", ")}`);
  return value;
}

function plainDate(value, name) {
  if (value === null) return null;
  const result = text(value, name, { max: 40 }).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new PortableBackupError(`${name} must be a date`);
  return result;
}

function wholeNumber(value, name) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new PortableBackupError(`${name} must be a whole number`);
  return value;
}

function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PortableBackupError(`${name} must be an object`);
  return value;
}

function array(value, name) {
  if (!Array.isArray(value)) throw new PortableBackupError(`${name} must be an array`);
  return value;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new PortableBackupError(`${name} must be a positive integer`);
  return value;
}

function text(value, name, { nullable = false, max = 1_000_000 } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new PortableBackupError(`${name} must be text${nullable ? " or null" : ""}`);
  if (value.length > max) throw new PortableBackupError(`${name} is too long`);
  return value;
}

function number(value, name) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PortableBackupError(`${name} must be a number or null`);
  return value;
}

function boolean(value, name) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return Boolean(value);
  throw new PortableBackupError(`${name} must be a boolean`);
}

// SQLite stores CURRENT_TIMESTAMP as UTC without a zone ("2026-08-21 12:00:00").
// Mark such values as UTC so PostgreSQL does not read them in its local time zone.
function timestamp(value, name, nullable = false) {
  const result = text(value, name, { nullable, max: 80 });
  if (result === null) return null;
  const normalized = /Z$|[+-]\d\d(:?\d\d)?$/.test(result) ? result : `${result.replace(" ", "T")}Z`;
  if (Number.isNaN(Date.parse(normalized))) throw new PortableBackupError(`${name} must be a timestamp`);
  return normalized;
}

function unique(rows, field, name) {
  const values = rows.map((row) => row[field]);
  if (new Set(values).size !== values.length) throw new PortableBackupError(`${name} contains duplicate ${field} values`);
}

export function validatePortableBackup(value) {
  const archive = record(value, "backup");
  if (archive.format !== FORMAT || !SUPPORTED_VERSIONS.includes(archive.version)) throw new PortableBackupError("Unsupported DBRepairs portable backup");
  const data = record(archive.data, "data");

  const settings = array(data.settings, "settings").map((item, index) => {
    const row = record(item, `settings[${index}]`);
    return { key: text(row.key, `settings[${index}].key`, { max: 300 }), value: text(row.value, `settings[${index}].value`, { max: 3_000_000 }) };
  });
  const statuses = array(data.statuses, "statuses").map((item, index) => {
    const row = record(item, `statuses[${index}]`);
    return {
      id: integer(row.id, `statuses[${index}].id`), code: text(row.code, `statuses[${index}].code`, { max: 100 }),
      label_key: text(row.label_key, `statuses[${index}].label_key`, { max: 200 }),
      sort_order: Number.isSafeInteger(row.sort_order) ? row.sort_order : (() => { throw new PortableBackupError(`statuses[${index}].sort_order must be an integer`); })(),
      active: boolean(row.active, `statuses[${index}].active`),
    };
  });
  const customers = array(data.customers, "customers").map((item, index) => {
    const row = record(item, `customers[${index}]`);
    return {
      id: integer(row.id, `customers[${index}].id`), name: text(row.name, `customers[${index}].name`, { max: 1000 }),
      company: text(row.company, `customers[${index}].company`, { nullable: true }), tax_number: text(row.tax_number, `customers[${index}].tax_number`, { nullable: true }),
      phone: text(row.phone, `customers[${index}].phone`, { nullable: true }), email: text(row.email, `customers[${index}].email`, { nullable: true }),
      address: text(row.address, `customers[${index}].address`, { nullable: true }), notes: text(row.notes, `customers[${index}].notes`, { nullable: true }),
      created_at: timestamp(row.created_at, `customers[${index}].created_at`), updated_at: timestamp(row.updated_at, `customers[${index}].updated_at`),
      customer_type: optional(row.customer_type, "residential", (v) => oneOf(v, `customers[${index}].customer_type`, ["residential", "commercial"])),
      contact_person: optional(row.contact_person, null, (v) => text(v, `customers[${index}].contact_person`, { nullable: true })),
      mobile: optional(row.mobile, null, (v) => text(v, `customers[${index}].mobile`, { nullable: true })),
      preferred_contact: optional(row.preferred_contact, null, (v) => v === null ? null : oneOf(v, `customers[${index}].preferred_contact`, ["email", "phone", "sms"])),
      tags: optional(row.tags, null, (v) => text(v, `customers[${index}].tags`, { nullable: true })),
      is_retainer: optional(row.is_retainer, false, (v) => boolean(v, `customers[${index}].is_retainer`)),
      retainer_plan: optional(row.retainer_plan, null, (v) => text(v, `customers[${index}].retainer_plan`, { nullable: true })),
      retainer_monthly_fee: optional(row.retainer_monthly_fee, null, (v) => number(v, `customers[${index}].retainer_monthly_fee`)),
      retainer_renewal_date: optional(row.retainer_renewal_date, null, (v) => plainDate(v, `customers[${index}].retainer_renewal_date`)),
    };
  });
  const repairs = array(data.repairs, "repairs").map((item, index) => {
    const row = record(item, `repairs[${index}]`);
    return {
      id: integer(row.id, `repairs[${index}].id`), repair_number: text(row.repair_number, `repairs[${index}].repair_number`, { max: 200 }),
      customer_id: integer(row.customer_id, `repairs[${index}].customer_id`), status_id: integer(row.status_id, `repairs[${index}].status_id`),
      device_type: text(row.device_type, `repairs[${index}].device_type`, { nullable: true }), brand: text(row.brand, `repairs[${index}].brand`, { nullable: true }),
      model: text(row.model, `repairs[${index}].model`, { nullable: true }), serial_number: text(row.serial_number, `repairs[${index}].serial_number`, { nullable: true }),
      imei: text(row.imei, `repairs[${index}].imei`, { nullable: true }), reported_fault: text(row.reported_fault, `repairs[${index}].reported_fault`, { nullable: true }),
      accessories: text(row.accessories, `repairs[${index}].accessories`, { nullable: true }), general_condition: text(row.general_condition, `repairs[${index}].general_condition`, { nullable: true }),
      diagnosis: text(row.diagnosis, `repairs[${index}].diagnosis`, { nullable: true }), work_performed: text(row.work_performed, `repairs[${index}].work_performed`, { nullable: true }),
      estimated_value: number(row.estimated_value, `repairs[${index}].estimated_value`), final_value: number(row.final_value, `repairs[${index}].final_value`),
      internal_notes: text(row.internal_notes, `repairs[${index}].internal_notes`, { nullable: true }), opened_at: timestamp(row.opened_at, `repairs[${index}].opened_at`),
      closed_at: timestamp(row.closed_at, `repairs[${index}].closed_at`, true), created_at: timestamp(row.created_at, `repairs[${index}].created_at`),
      updated_at: timestamp(row.updated_at, `repairs[${index}].updated_at`),
      priority: optional(row.priority, "normal", (v) => oneOf(v, `repairs[${index}].priority`, ["low", "normal", "high", "urgent"])),
      due_date: optional(row.due_date, null, (v) => plainDate(v, `repairs[${index}].due_date`)),
      technician: optional(row.technician, null, (v) => text(v, `repairs[${index}].technician`, { nullable: true })),
      deposit: optional(row.deposit, null, (v) => number(v, `repairs[${index}].deposit`)),
      paid: optional(row.paid, false, (v) => boolean(v, `repairs[${index}].paid`)),
      warranty_days: optional(row.warranty_days, null, (v) => wholeNumber(v, `repairs[${index}].warranty_days`)),
    };
  });
  const history = array(data.history, "history").map((item, index) => {
    const row = record(item, `history[${index}]`);
    return {
      id: integer(row.id, `history[${index}].id`), repair_id: integer(row.repair_id, `history[${index}].repair_id`),
      status_id: integer(row.status_id, `history[${index}].status_id`), changed_at: timestamp(row.changed_at, `history[${index}].changed_at`),
      note: text(row.note, `history[${index}].note`, { nullable: true }),
    };
  });

  const parts = optional(data.parts, [], (v) => array(v, "parts")).map((item, index) => {
    const row = record(item, `parts[${index}]`);
    return {
      id: integer(row.id, `parts[${index}].id`), repair_id: integer(row.repair_id, `parts[${index}].repair_id`),
      name: text(row.name, `parts[${index}].name`, { max: 1000 }),
      part_number: text(row.part_number, `parts[${index}].part_number`, { nullable: true }), supplier: text(row.supplier, `parts[${index}].supplier`, { nullable: true }),
      url: text(row.url, `parts[${index}].url`, { nullable: true, max: 4000 }), quantity: integer(row.quantity, `parts[${index}].quantity`),
      unit_cost: number(row.unit_cost, `parts[${index}].unit_cost`),
      status: oneOf(row.status, `parts[${index}].status`, ["needed", "ordered", "received", "installed", "cancelled"]),
      notes: text(row.notes, `parts[${index}].notes`, { nullable: true }),
      ordered_at: timestamp(row.ordered_at, `parts[${index}].ordered_at`, true), received_at: timestamp(row.received_at, `parts[${index}].received_at`, true),
      created_at: timestamp(row.created_at, `parts[${index}].created_at`), updated_at: timestamp(row.updated_at, `parts[${index}].updated_at`),
    };
  });
  // Part links are opened from the app, so keep only web addresses.
  if (parts.some((row) => row.url !== null && !/^https?:\/\//i.test(row.url))) throw new PortableBackupError("Part links must start with http:// or https://");

  if (!statuses.length) throw new PortableBackupError("At least one repair status is required");
  unique(settings, "key", "settings"); unique(statuses, "id", "statuses"); unique(statuses, "code", "statuses");
  unique(customers, "id", "customers"); unique(repairs, "id", "repairs"); unique(repairs, "repair_number", "repairs"); unique(history, "id", "history");
  const customerIds = new Set(customers.map((row) => row.id));
  const statusIds = new Set(statuses.map((row) => row.id));
  const repairIds = new Set(repairs.map((row) => row.id));
  if (repairs.some((row) => !customerIds.has(row.customer_id) || !statusIds.has(row.status_id))) throw new PortableBackupError("A repair references a missing customer or status");
  if (history.some((row) => !repairIds.has(row.repair_id) || !statusIds.has(row.status_id))) throw new PortableBackupError("Status history references a missing repair or status");
  unique(parts, "id", "parts");
  if (parts.some((row) => !repairIds.has(row.repair_id))) throw new PortableBackupError("A part references a missing repair");

  return {
    format: FORMAT, version: archive.version, createdAt: timestamp(archive.createdAt, "createdAt"),
    sourceEngine: archive.sourceEngine === "sqlite" || archive.sourceEngine === "postgresql" ? archive.sourceEngine : (() => { throw new PortableBackupError("Invalid source engine"); })(),
    data: { settings, statuses, customers, repairs, history, parts },
  };
}

export async function exportPortableBackup(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const [settings, statuses, customers, repairs, history, parts] = await Promise.all([
      client.query("SELECT key,value FROM app_settings ORDER BY key"),
      client.query("SELECT id,code,label_key,sort_order,active FROM repair_statuses ORDER BY id"),
      client.query(`SELECT id,name,company,tax_number,phone,email,address,notes,created_at,updated_at,customer_type,contact_person,mobile,
        preferred_contact,tags,is_retainer,retainer_plan,retainer_monthly_fee,retainer_renewal_date FROM customers ORDER BY id`),
      client.query(`SELECT id,repair_number,customer_id,status_id,device_type,brand,model,serial_number,imei,reported_fault,accessories,general_condition,
        diagnosis,work_performed,estimated_value,final_value,internal_notes,opened_at,closed_at,created_at,updated_at,priority,due_date,technician,
        deposit,paid,warranty_days FROM repairs ORDER BY id`),
      client.query("SELECT id,repair_id,status_id,changed_at,note FROM repair_status_history ORDER BY id"),
      client.query(`SELECT id,repair_id,name,part_number,supplier,url,quantity,unit_cost,status,notes,ordered_at,received_at,created_at,updated_at
        FROM repair_parts ORDER BY id`),
    ]);
    await client.query("COMMIT");
    return { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), sourceEngine: "postgresql", data: {
      settings: settings.rows, statuses: statuses.rows, customers: customers.rows, repairs: repairs.rows, history: history.rows, parts: parts.rows,
    } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function importPortableBackup(pool, value) {
  const archive = validatePortableBackup(value);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(87234022)");
    await client.query("DELETE FROM repair_parts; DELETE FROM repair_status_history; DELETE FROM repairs; DELETE FROM customers; DELETE FROM repair_statuses; DELETE FROM app_settings");
    const tables = [["app_settings", archive.data.settings], ["repair_statuses", archive.data.statuses], ["customers", archive.data.customers],
      ["repairs", archive.data.repairs], ["repair_status_history", archive.data.history], ["repair_parts", archive.data.parts]];
    for (const [table, rows] of tables) {
      for (const row of rows) {
        // Column names come from the validated archive shape above, never from the file itself.
        const columns = Object.keys(row);
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
      }
    }
    for (const table of ["repair_statuses","customers","repairs","repair_status_history","repair_parts"]) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${table}`);
    }
    await client.query("COMMIT");
    return archive;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
