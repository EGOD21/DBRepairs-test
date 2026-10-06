export class ValidationError extends Error {}

export const CUSTOMER_TYPES = ["residential", "commercial"];
export const CONTACT_METHODS = ["email", "phone", "sms"];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const PART_STATUSES = ["needed", "ordered", "received", "installed", "cancelled"];

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected a JSON object");
  }
  return value;
}

function text(value, field, { required = false, max = 10000 } = {}) {
  if (value == null) value = "";
  if (typeof value !== "string") throw new ValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed || null;
}

function id(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ValidationError(`${field} must be a positive integer`);
  return parsed;
}

function money(value, field) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError(`${field} must be a positive number`);
  return parsed;
}

function wholeNumber(value, field, { min = 0, max = 100000 } = {}) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new ValidationError(`${field} must be a whole number`);
  return parsed;
}

function choice(value, field, options, fallback) {
  if (value === "" || value == null) return fallback;
  if (!options.includes(value)) throw new ValidationError(`${field} must be one of ${options.join(", ")}`);
  return value;
}

function date(value, field) {
  if (value === "" || value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

function flag(value) {
  return value === true || value === 1 || value === "true";
}

// Only web links may be stored, so a part link can never run script when clicked.
export function webUrl(value, field = "url") {
  const result = text(value, field, { max: 2000 });
  if (result === null) return null;
  let parsed;
  try { parsed = new URL(result); } catch { throw new ValidationError(`${field} must be a web address starting with https://`); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ValidationError(`${field} must start with https:// or http://`);
  return parsed.toString();
}

export function customerInput(value) {
  const body = object(value);
  const isRetainer = flag(body.isRetainer);
  return {
    name: text(body.name, "name", { required: true, max: 200 }),
    company: text(body.company, "company", { max: 200 }),
    taxNumber: text(body.taxNumber, "taxNumber", { max: 80 }),
    phone: text(body.phone, "phone", { max: 80 }),
    mobile: text(body.mobile, "mobile", { max: 80 }),
    email: text(body.email, "email", { max: 254 }),
    address: text(body.address, "address", { max: 1000 }),
    notes: text(body.notes, "notes"),
    customerType: choice(body.customerType, "customerType", CUSTOMER_TYPES, "residential"),
    contactPerson: text(body.contactPerson, "contactPerson", { max: 200 }),
    preferredContact: choice(body.preferredContact, "preferredContact", CONTACT_METHODS, null),
    tags: text(body.tags, "tags", { max: 500 }),
    isRetainer,
    retainerPlan: isRetainer ? text(body.retainerPlan, "retainerPlan", { max: 200 }) : null,
    retainerMonthlyFee: isRetainer ? money(body.retainerMonthlyFee, "retainerMonthlyFee") : null,
    retainerRenewalDate: isRetainer ? date(body.retainerRenewalDate, "retainerRenewalDate") : null,
  };
}

export function repairInput(value, update = false) {
  const body = object(value);
  const result = {
    customer_id: id(body.customer_id, "customer_id"),
    status_id: id(body.status_id, "status_id"),
    device_type: text(body.device_type, "device_type", { max: 200 }),
    brand: text(body.brand, "brand", { max: 200 }),
    model: text(body.model, "model", { max: 200 }),
    serial_number: text(body.serial_number, "serial_number", { max: 200 }),
    imei: text(body.imei, "imei", { max: 200 }),
    reported_fault: text(body.reported_fault, "reported_fault", { required: true }),
    accessories: text(body.accessories, "accessories"),
    general_condition: text(body.general_condition, "general_condition"),
    estimated_value: money(body.estimated_value, "estimated_value"),
    internal_notes: text(body.internal_notes, "internal_notes"),
    priority: choice(body.priority, "priority", PRIORITIES, "normal"),
    due_date: date(body.due_date, "due_date"),
    technician: text(body.technician, "technician", { max: 200 }),
    deposit: money(body.deposit, "deposit"),
    paid: flag(body.paid),
    warranty_days: wholeNumber(body.warranty_days, "warranty_days", { max: 3650 }),
  };
  if (update) {
    result.diagnosis = text(body.diagnosis, "diagnosis");
    result.work_performed = text(body.work_performed, "work_performed");
    result.final_value = money(body.final_value, "final_value");
    result.statusNote = text(body.statusNote, "statusNote");
  }
  return result;
}

export function partInput(value) {
  const body = object(value);
  return {
    name: text(body.name, "name", { required: true, max: 300 }),
    part_number: text(body.part_number, "part_number", { max: 200 }),
    supplier: text(body.supplier, "supplier", { max: 200 }),
    url: webUrl(body.url),
    quantity: wholeNumber(body.quantity, "quantity", { min: 1, max: 10000 }) ?? 1,
    unit_cost: money(body.unit_cost, "unit_cost"),
    status: choice(body.status, "status", PART_STATUSES, "needed"),
    notes: text(body.notes, "notes", { max: 2000 }),
  };
}

// Settings the app understands, with the limit for each value.
export const SETTING_LIMITS = {
  "office.companyName": 1000,
  "office.taxNumber": 1000,
  "office.address": 1000,
  "office.phone": 1000,
  "office.email": 1000,
  "office.website": 1000,
  "office.logoDataUrl": 3_000_000,
  // Home-screen icons drawn from the logo in the browser (see src/lib/appIcons.ts).
  "app.icon192": 1_000_000,
  "app.icon512": 3_000_000,
  "app.iconMaskable": 3_000_000,
  "app.iconApple": 1_000_000,
  "ui.theme": 20_000,
  "print.autoPrint": 50,
  "print.labelSize": 50,
  "print.terms": 4000,
  "email.signature": 2000,
};

// Theme values become CSS custom properties, so allow only plain colors,
// lengths and font names: no url(), no semicolons, no braces.
function validateTheme(json) {
  let theme;
  try { theme = object(JSON.parse(json)); } catch { throw new ValidationError("ui.theme must be a JSON object"); }
  for (const [key, value] of Object.entries(theme)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key) || typeof value !== "string" || value.length > 200 || !/^[#a-zA-Z0-9 ,.()%'"-]*$/.test(value) || /url\s*\(/i.test(value)) {
      throw new ValidationError(`ui.theme.${key} is not an allowed value`);
    }
  }
}

export function settingsInput(value) {
  const body = object(value);
  const result = {};
  for (const [key, raw] of Object.entries(body)) {
    const max = SETTING_LIMITS[key];
    if (max === undefined) throw new ValidationError(`Unknown setting ${key}`);
    const cleaned = text(raw, key, { max }) || "";
    if (key === "office.logoDataUrl" && cleaned && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(cleaned)) {
      throw new ValidationError("The logo must be a PNG, JPEG or WebP image");
    }
    if (key.startsWith("app.icon") && cleaned && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(cleaned)) {
      throw new ValidationError("App icons must be PNG images");
    }
    if (key === "ui.theme" && cleaned) validateTheme(cleaned);
    result[key] = cleaned;
  }
  return result;
}

export function pathId(value, field = "id") {
  return id(value, field);
}
