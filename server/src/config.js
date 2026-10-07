import { createSessionKey } from "./auth.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isPlaceholder(value) {
  return /change-this|replace-with/i.test(value);
}

export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  const database = databaseUrl ? { connectionString: databaseUrl } : {
    host: env.PGHOST?.trim(),
    port: positiveInteger(env.PGPORT, 5432),
    database: env.PGDATABASE?.trim(),
    user: env.PGUSER?.trim(),
    password: env.PGPASSWORD,
  };
  if (!databaseUrl && (!database.host || !database.database || !database.user || !database.password)) {
    throw new Error("DATABASE_URL or PGHOST, PGDATABASE, PGUSER and PGPASSWORD are required");
  }
  if (database.password && isPlaceholder(database.password)) {
    throw new Error("The database password is still the example value. Set a unique password before starting DBRepairs");
  }

  const password = env.DBREPAIRS_PASSWORD ?? "";
  if (password.length < 8) throw new Error("DBREPAIRS_PASSWORD is required and must be at least 8 characters long");
  if (isPlaceholder(password)) {
    throw new Error("DBREPAIRS_PASSWORD is still the example value. Set a unique password before starting DBRepairs");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env.PORT, 3000),
    database,
    databasePoolSize: positiveInteger(env.DATABASE_POOL_SIZE, 10),
    trustProxy: env.TRUST_PROXY === "true",
    // Repair photos are files in this folder (its own Docker volume), not in the database.
    photosDir: env.PHOTOS_DIR?.trim() || "/data/photos",
    // Photo cleanup, maintenance tickets and contract invoices run on a timer.
    backgroundJobs: true,
    // Encrypts the password vault. Without it the vault stays off.
    vaultSecret: env.VAULT_KEY?.trim() || "",
    auth: { password, sessionKey: createSessionKey(password, env.SESSION_SECRET ?? "") },
  };
}
