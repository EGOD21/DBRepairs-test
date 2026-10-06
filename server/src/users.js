import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ValidationError } from "./validation.js";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16384;

export const ADMIN_USERNAME = "admin";
export const ROLES = ["admin", "tech"];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: 8, p: 1 });
  return `scrypt$${COST}$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const userColumns = "id, username, display_name, role, active, session_version, created_at, updated_at";

export function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: row.active, createdAt: row.created_at };
}

export async function findUserByUsername(pool, username) {
  const result = await pool.query(`SELECT ${userColumns}, password_hash FROM users WHERE lower(username)=lower($1)`, [username]);
  return result.rows[0] ?? null;
}

export async function findUserById(pool, id) {
  const result = await pool.query(`SELECT ${userColumns} FROM users WHERE id=$1`, [id]);
  return result.rows[0] ?? null;
}

export async function listUsers(pool) {
  return (await pool.query(`SELECT ${userColumns} FROM users ORDER BY lower(display_name), id`)).rows.map(publicUser);
}

/**
 * Keeps the built-in "admin" account in step with DBREPAIRS_PASSWORD. When the
 * environment password changes, the stored hash is replaced and old admin
 * sessions end.
 */
export async function ensureAdmin(pool, password) {
  const existing = await findUserByUsername(pool, ADMIN_USERNAME);
  if (!existing) {
    await pool.query(`INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
      [ADMIN_USERNAME, "Admin", await hashPassword(password)]);
    return;
  }
  if (existing.role !== "admin" || !existing.active || !(await verifyPassword(password, existing.password_hash))) {
    await pool.query(`UPDATE users SET password_hash=$1, role='admin', active=true, session_version=session_version+1, updated_at=now() WHERE id=$2`,
      [await hashPassword(password), existing.id]);
  }
}

function text(value, field, { min = 0, max = 200 } = {}) {
  if (typeof value !== "string") throw new ValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ValidationError(min > 1 ? `${field} must be at least ${min} characters` : `${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed;
}

export function newPassword(value) {
  if (typeof value !== "string" || value.length < 8) throw new ValidationError("The password must be at least 8 characters");
  if (value.length > 200) throw new ValidationError("The password is too long");
  return value;
}

export function userInput(value, { creating }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected a JSON object");
  const result = {
    displayName: text(value.displayName, "displayName", { min: 1, max: 100 }),
    role: ROLES.includes(value.role) ? value.role : (() => { throw new ValidationError("role must be admin or tech"); })(),
    active: value.active === undefined ? true : value.active === true,
    password: value.password ? newPassword(value.password) : null,
  };
  if (creating) {
    result.username = text(value.username, "username", { min: 2, max: 40 });
    if (!/^[a-zA-Z0-9._-]+$/.test(result.username)) throw new ValidationError("The username may only use letters, numbers, dots, dashes and underscores");
    if (!result.password) throw new ValidationError("A password is required");
  }
  return result;
}
