-- Customer profiles: residential/commercial, retainer clients, extra contacts.
ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'residential';
ALTER TABLE customers ADD COLUMN contact_person TEXT;
ALTER TABLE customers ADD COLUMN mobile TEXT;
ALTER TABLE customers ADD COLUMN preferred_contact TEXT;
ALTER TABLE customers ADD COLUMN tags TEXT;
ALTER TABLE customers ADD COLUMN is_retainer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN retainer_plan TEXT;
ALTER TABLE customers ADD COLUMN retainer_monthly_fee REAL;
ALTER TABLE customers ADD COLUMN retainer_renewal_date TEXT;

-- Repair workflow: priority, promised date, technician, payment and warranty.
ALTER TABLE repairs ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE repairs ADD COLUMN due_date TEXT;
ALTER TABLE repairs ADD COLUMN technician TEXT;
ALTER TABLE repairs ADD COLUMN deposit REAL;
ALTER TABLE repairs ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repairs ADD COLUMN warranty_days INTEGER;

-- Parts that a repair needs, with where to order them.
CREATE TABLE IF NOT EXISTS repair_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  part_number TEXT,
  supplier TEXT,
  url TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost REAL,
  status TEXT NOT NULL DEFAULT 'needed',
  notes TEXT,
  ordered_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(repair_id) REFERENCES repairs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS repair_parts_repair_id_idx ON repair_parts(repair_id);
CREATE INDEX IF NOT EXISTS repair_parts_status_idx ON repair_parts(status);
