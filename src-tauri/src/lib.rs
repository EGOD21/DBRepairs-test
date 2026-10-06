use std::{fs, path::{Path, PathBuf}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;


const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
fn is_sqlite_database(data: &[u8]) -> bool { data.len() >= 16 && &data[..16] == SQLITE_HEADER }
fn remove_if_exists(path: &Path) -> Result<(), String> { if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?;} Ok(()) }
fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> { Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("dbrepairs.db")) }
fn open_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path=database_path(app)?; if !path.exists(){return Err("Database file not found".into());}
    let connection=Connection::open(path).map_err(|e|e.to_string())?;
    connection.busy_timeout(Duration::from_secs(5)).map_err(|e|e.to_string())?;
    connection.pragma_update(None, "foreign_keys", true).map_err(|e|e.to_string())?;
    Ok(connection)
}
// VACUUM INTO writes a consistent copy even while the app has the database open.
fn snapshot_database(source: &Path, destination: &Path) -> Result<(), String> {
    let connection=Connection::open(source).map_err(|e|e.to_string())?;
    connection.busy_timeout(Duration::from_secs(5)).map_err(|e|e.to_string())?;
    remove_if_exists(destination)?;
    connection.execute("VACUUM INTO ?1", params![destination.to_string_lossy()]).map_err(|e|e.to_string())?; Ok(())
}
fn unix_stamp() -> Result<u64, String> { Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_secs()) }
fn apply_pending_restore(app: &tauri::AppHandle) -> Result<(), String> {
    let dir=app.path().app_config_dir().map_err(|e|e.to_string())?;
    let db=dir.join("dbrepairs.db"); let pending=dir.join("dbrepairs.restore.pending");
    if !pending.exists(){return Ok(());}
    let data=fs::read(&pending).map_err(|e|e.to_string())?;
    if !is_sqlite_database(&data){return Err("Invalid pending SQLite restore".into());}
    let rollback=dir.join("dbrepairs.restore.rollback"); remove_if_exists(&rollback)?;
    if db.exists(){fs::rename(&db,&rollback).map_err(|e|e.to_string())?;}
    if let Err(e)=fs::rename(&pending,&db){if rollback.exists()&&!db.exists(){let _=fs::rename(&rollback,&db);}return Err(e.to_string());}
    let _=remove_if_exists(&dir.join("dbrepairs.db-wal")); let _=remove_if_exists(&dir.join("dbrepairs.db-shm")); let _=remove_if_exists(&rollback); Ok(())
}

#[tauri::command]
fn backup_database(app: tauri::AppHandle) -> Result<String, String> {
    let source = database_path(&app)?;
    if !source.exists() {
        return Err("Database file not found".into());
    }

    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;

    let destination = downloads.join(format!("DBRepairs-backup-{}.db", unix_stamp()?));
    snapshot_database(&source, &destination)?;

    Ok(destination.to_string_lossy().into_owned())
}

// The frontend sends the file as a raw byte body; JSON would turn every byte into a number.
#[tauri::command]
fn restore_database(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("Expected the database file as raw bytes".into()); };
    if !is_sqlite_database(data){return Err("Selected file is not a valid SQLite database".into());}
    let dir=app.path().app_config_dir().map_err(|e|e.to_string())?; fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let db=dir.join("dbrepairs.db"); if !db.exists(){return Err("Current database file not found".into());}
    let downloads=app.path().download_dir().map_err(|e|e.to_string())?; fs::create_dir_all(&downloads).map_err(|e|e.to_string())?;
    snapshot_database(&db,&downloads.join(format!("DBRepairs-before-restore-{}.db", unix_stamp()?)))?;
    fs::write(dir.join("dbrepairs.restore.pending"),data).map_err(|e|e.to_string())?;
    if cfg!(debug_assertions) {
        app.exit(0);
        Ok(())
    } else {
        app.restart()
    }
}

#[tauri::command]
fn export_text_file(app: tauri::AppHandle, filename: String, content: String) -> Result<String, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".into());
    }

    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;

    let destination = downloads.join(filename);
    fs::write(&destination, content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(destination.to_string_lossy().into_owned())
}

// Plain names only: no folders, drive letters (C:) or hidden files.
fn is_safe_filename(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

#[derive(Deserialize)]
struct RepairFields {
    customer_id: i64, status_id: i64, device_type: Option<String>, brand: Option<String>, model: Option<String>,
    serial_number: Option<String>, imei: Option<String>, reported_fault: Option<String>, accessories: Option<String>,
    general_condition: Option<String>, estimated_value: Option<f64>, internal_notes: Option<String>,
    diagnosis: Option<String>, work_performed: Option<String>, final_value: Option<f64>,
    #[serde(default = "default_priority")] priority: String, due_date: Option<String>, technician: Option<String>,
    deposit: Option<f64>, #[serde(default)] paid: bool, warranty_days: Option<i64>,
}

fn default_priority() -> String { "normal".into() }
fn default_customer_type() -> String { "residential".into() }
fn is_plain_date(value: &str) -> bool { value.len() == 10 && value.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }) }

fn clean_text(value: Option<String>) -> Option<String> { value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) }

impl RepairFields {
    fn validated(mut self) -> Result<Self, String> {
        if self.customer_id < 1 || self.status_id < 1 { return Err("A customer and a status are required".into()); }
        if !["low","normal","high","urgent"].contains(&self.priority.as_str()) { return Err("Unknown priority".into()); }
        self.due_date=clean_text(self.due_date);
        if self.due_date.as_deref().is_some_and(|d| !is_plain_date(d)) { return Err("The due date must be YYYY-MM-DD".into()); }
        if self.warranty_days.is_some_and(|d| !(0..=3650).contains(&d)) { return Err("Warranty days must be between 0 and 3650".into()); }
        self.technician=clean_text(self.technician);
        for value in [self.estimated_value, self.final_value, self.deposit].into_iter().flatten() {
            if !value.is_finite() || value < 0.0 { return Err("Values must be positive numbers".into()); }
        }
        self.device_type=clean_text(self.device_type); self.brand=clean_text(self.brand); self.model=clean_text(self.model);
        self.serial_number=clean_text(self.serial_number); self.imei=clean_text(self.imei); self.reported_fault=clean_text(self.reported_fault);
        self.accessories=clean_text(self.accessories); self.general_condition=clean_text(self.general_condition);
        self.internal_notes=clean_text(self.internal_notes); self.diagnosis=clean_text(self.diagnosis); self.work_performed=clean_text(self.work_performed);
        if self.reported_fault.is_none() { return Err("The reported fault is required".into()); }
        Ok(self)
    }
}

// The repair, its number and its first history entry are saved together or not at all.
fn create_repair_record(connection: &mut Connection, repair: RepairFields) -> Result<i64, String> {
    let r = repair.validated()?;
    let transaction = connection.transaction().map_err(|e|e.to_string())?;
    transaction.execute("INSERT INTO repairs (repair_number,customer_id,status_id,device_type,brand,model,serial_number,imei,reported_fault,accessories,general_condition,estimated_value,internal_notes,priority,due_date,technician,deposit,paid,warranty_days) VALUES ('TMP-'||lower(hex(randomblob(16))),?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        params![r.customer_id,r.status_id,r.device_type,r.brand,r.model,r.serial_number,r.imei,r.reported_fault,r.accessories,r.general_condition,r.estimated_value,r.internal_notes,r.priority,r.due_date,r.technician,r.deposit,r.paid,r.warranty_days]).map_err(|e|e.to_string())?;
    let id = transaction.last_insert_rowid();
    transaction.execute("UPDATE repairs SET repair_number=strftime('%Y',opened_at,'localtime')||'-'||printf('%06d',id) WHERE id=?1", params![id]).map_err(|e|e.to_string())?;
    transaction.execute("INSERT INTO repair_status_history (repair_id,status_id) VALUES (?1,?2)", params![id,r.status_id]).map_err(|e|e.to_string())?;
    transaction.commit().map_err(|e|e.to_string())?;
    Ok(id)
}

// The repair update and its status history entry are saved together or not at all.
fn update_repair_record(connection: &mut Connection, id: i64, repair: RepairFields, status_note: Option<String>) -> Result<(), String> {
    let r = repair.validated()?;
    let transaction = connection.transaction().map_err(|e|e.to_string())?;
    let previous: Option<i64> = transaction.query_row("SELECT status_id FROM repairs WHERE id=?1", params![id], |row| row.get(0)).optional().map_err(|e|e.to_string())?;
    let Some(previous_status) = previous else { return Err("Repair not found".into()); };
    transaction.execute("UPDATE repairs SET customer_id=?1, status_id=?2, device_type=?3, brand=?4, model=?5, serial_number=?6, imei=?7, reported_fault=?8, accessories=?9, general_condition=?10, diagnosis=?11, work_performed=?12, estimated_value=?13, final_value=?14, internal_notes=?15, priority=?17, due_date=?18, technician=?19, deposit=?20, paid=?21, warranty_days=?22, updated_at=CURRENT_TIMESTAMP, closed_at=CASE WHEN (SELECT code FROM repair_statuses WHERE id=?2) IN ('DELIVERED','CANCELLED') THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?16",
        params![r.customer_id,r.status_id,r.device_type,r.brand,r.model,r.serial_number,r.imei,r.reported_fault,r.accessories,r.general_condition,r.diagnosis,r.work_performed,r.estimated_value,r.final_value,r.internal_notes,id,r.priority,r.due_date,r.technician,r.deposit,r.paid,r.warranty_days]).map_err(|e|e.to_string())?;
    if previous_status != r.status_id {
        transaction.execute("INSERT INTO repair_status_history (repair_id,status_id,note) VALUES (?1,?2,?3)", params![id,r.status_id,clean_text(status_note)]).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e|e.to_string())
}

#[tauri::command]
fn create_repair(app: tauri::AppHandle, repair: RepairFields) -> Result<i64, String> {
    create_repair_record(&mut open_database(&app)?, repair)
}

#[tauri::command]
fn update_repair(app: tauri::AppHandle, id: i64, repair: RepairFields, status_note: Option<String>) -> Result<(), String> {
    update_repair_record(&mut open_database(&app)?, id, repair, status_note)
}

// Removes a repair with its parts and status history in one transaction.
fn delete_repair_record(connection: &mut Connection, id: i64) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|e|e.to_string())?;
    transaction.execute("DELETE FROM repair_parts WHERE repair_id=?1", params![id]).map_err(|e|e.to_string())?;
    transaction.execute("DELETE FROM repair_status_history WHERE repair_id=?1", params![id]).map_err(|e|e.to_string())?;
    if transaction.execute("DELETE FROM repairs WHERE id=?1", params![id]).map_err(|e|e.to_string())? == 0 { return Err("Repair not found".into()); }
    transaction.commit().map_err(|e|e.to_string())
}

#[tauri::command]
fn delete_repair(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    delete_repair_record(&mut open_database(&app)?, id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableArchive { format: String, version: u32, data: PortableData }
#[derive(Deserialize)]
struct PortableData { settings: Vec<PortableSetting>, statuses: Vec<PortableStatus>, customers: Vec<PortableCustomer>, repairs: Vec<PortableRepair>, history: Vec<PortableHistory>, #[serde(default)] parts: Vec<PortablePart> }
#[derive(Deserialize)]
struct PortableSetting { key: String, value: String }
#[derive(Deserialize)]
struct PortableStatus { id: i64, code: String, label_key: String, sort_order: i64, active: bool }
#[derive(Deserialize)]
// Fields marked default were added in version 2 and are absent from version 1 archives.
struct PortableCustomer {
    id: i64, name: String, company: Option<String>, tax_number: Option<String>, phone: Option<String>, email: Option<String>, address: Option<String>, notes: Option<String>, created_at: String, updated_at: String,
    #[serde(default = "default_customer_type")] customer_type: String, #[serde(default)] contact_person: Option<String>, #[serde(default)] mobile: Option<String>,
    #[serde(default)] preferred_contact: Option<String>, #[serde(default)] tags: Option<String>, #[serde(default)] is_retainer: bool,
    #[serde(default)] retainer_plan: Option<String>, #[serde(default)] retainer_monthly_fee: Option<f64>, #[serde(default)] retainer_renewal_date: Option<String>,
}
#[derive(Deserialize)]
struct PortableRepair {
    id: i64, repair_number: String, customer_id: i64, status_id: i64, device_type: Option<String>, brand: Option<String>, model: Option<String>,
    serial_number: Option<String>, imei: Option<String>, reported_fault: Option<String>, accessories: Option<String>, general_condition: Option<String>,
    diagnosis: Option<String>, work_performed: Option<String>, estimated_value: Option<f64>, final_value: Option<f64>, internal_notes: Option<String>,
    opened_at: String, closed_at: Option<String>, created_at: String, updated_at: String,
    #[serde(default = "default_priority")] priority: String, #[serde(default)] due_date: Option<String>, #[serde(default)] technician: Option<String>,
    #[serde(default)] deposit: Option<f64>, #[serde(default)] paid: bool, #[serde(default)] warranty_days: Option<i64>,
}
#[derive(Deserialize)]
struct PortablePart {
    id: i64, repair_id: i64, name: String, part_number: Option<String>, supplier: Option<String>, url: Option<String>, quantity: i64,
    unit_cost: Option<f64>, status: String, notes: Option<String>, ordered_at: Option<String>, received_at: Option<String>, created_at: String, updated_at: String,
}
#[derive(Deserialize)]
struct PortableHistory { id: i64, repair_id: i64, status_id: i64, changed_at: String, note: Option<String> }

#[tauri::command]
fn restore_portable_database(app: tauri::AppHandle, archive: PortableArchive) -> Result<(), String> {
    if archive.format != "dbrepairs-portable" || !(1..=2).contains(&archive.version) || archive.data.statuses.is_empty() {
        return Err("Unsupported or incomplete DBRepairs portable backup".into());
    }
    restore_portable_connection(&mut open_database(&app)?, archive)
}

fn restore_portable_connection(connection: &mut Connection, archive: PortableArchive) -> Result<(), String> {
    connection.pragma_update(None, "foreign_keys", true).map_err(|e|e.to_string())?;
    let transaction = connection.transaction().map_err(|e|e.to_string())?;
    transaction.execute_batch("DELETE FROM repair_parts; DELETE FROM repair_status_history; DELETE FROM repairs; DELETE FROM customers; DELETE FROM repair_statuses; DELETE FROM app_settings;").map_err(|e|e.to_string())?;
    for row in archive.data.settings {
        transaction.execute("INSERT INTO app_settings (key,value) VALUES (?1,?2)", params![row.key,row.value]).map_err(|e|e.to_string())?;
    }
    for row in archive.data.statuses {
        transaction.execute("INSERT INTO repair_statuses (id,code,label_key,sort_order,active) VALUES (?1,?2,?3,?4,?5)", params![row.id,row.code,row.label_key,row.sort_order,row.active]).map_err(|e|e.to_string())?;
    }
    for row in archive.data.customers {
        transaction.execute("INSERT INTO customers (id,name,company,tax_number,phone,email,address,notes,created_at,updated_at,customer_type,contact_person,mobile,preferred_contact,tags,is_retainer,retainer_plan,retainer_monthly_fee,retainer_renewal_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)", params![row.id,row.name,row.company,row.tax_number,row.phone,row.email,row.address,row.notes,row.created_at,row.updated_at,row.customer_type,row.contact_person,row.mobile,row.preferred_contact,row.tags,row.is_retainer,row.retainer_plan,row.retainer_monthly_fee,row.retainer_renewal_date]).map_err(|e|e.to_string())?;
    }
    for row in archive.data.repairs {
        transaction.execute("INSERT INTO repairs (id,repair_number,customer_id,status_id,device_type,brand,model,serial_number,imei,reported_fault,accessories,general_condition,diagnosis,work_performed,estimated_value,final_value,internal_notes,opened_at,closed_at,created_at,updated_at,priority,due_date,technician,deposit,paid,warranty_days) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27)", params![row.id,row.repair_number,row.customer_id,row.status_id,row.device_type,row.brand,row.model,row.serial_number,row.imei,row.reported_fault,row.accessories,row.general_condition,row.diagnosis,row.work_performed,row.estimated_value,row.final_value,row.internal_notes,row.opened_at,row.closed_at,row.created_at,row.updated_at,row.priority,row.due_date,row.technician,row.deposit,row.paid,row.warranty_days]).map_err(|e|e.to_string())?;
    }
    for row in archive.data.history {
        transaction.execute("INSERT INTO repair_status_history (id,repair_id,status_id,changed_at,note) VALUES (?1,?2,?3,?4,?5)", params![row.id,row.repair_id,row.status_id,row.changed_at,row.note]).map_err(|e|e.to_string())?;
    }
    for row in archive.data.parts {
        if row.url.as_deref().is_some_and(|u| !(u.starts_with("https://") || u.starts_with("http://"))) { return Err("Part links must start with http:// or https://".into()); }
        transaction.execute("INSERT INTO repair_parts (id,repair_id,name,part_number,supplier,url,quantity,unit_cost,status,notes,ordered_at,received_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)", params![row.id,row.repair_id,row.name,row.part_number,row.supplier,row.url,row.quantity,row.unit_cost,row.status,row.notes,row.ordered_at,row.received_at,row.created_at,row.updated_at]).map_err(|e|e.to_string())?;
    }
    transaction.execute("DELETE FROM sqlite_sequence WHERE name IN ('repair_statuses','customers','repairs','repair_status_history','repair_parts')", []).map_err(|e|e.to_string())?;
    for table in ["repair_statuses","customers","repairs","repair_status_history","repair_parts"] {
        transaction.execute(&format!("INSERT INTO sqlite_sequence (name,seq) SELECT '{table}',COALESCE(MAX(id),0) FROM {table}"), []).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(value: serde_json::Value) -> PortableArchive { serde_json::from_value(value).unwrap() }

    #[test]
    fn portable_restore_of_version_1_is_transactional_and_resets_sequences() {
        let mut connection = test_database();
        connection.execute("INSERT INTO customers (name) VALUES ('Old data')", []).unwrap();
        let v1 = archive(serde_json::json!({ "format": "dbrepairs-portable", "version": 1, "createdAt": "2026-08-21T12:00:00Z", "sourceEngine": "sqlite", "data": {
            "settings": [{"key": "office.companyName", "value": "RepairsLab"}],
            "statuses": [{"id": 4, "code": "RECEIVED", "label_key": "status.received", "sort_order": 10, "active": true}],
            "customers": [{"id": 7, "name": "Portable customer", "company": null, "tax_number": null, "phone": null, "email": null, "address": null, "notes": null, "created_at": "2026-08-21 12:00:00", "updated_at": "2026-08-21 12:00:00"}],
            "repairs": [{"id": 9, "repair_number": "2026-000009", "customer_id": 7, "status_id": 4, "device_type": "Laptop", "brand": null, "model": null, "serial_number": null, "imei": null, "reported_fault": "Test", "accessories": null, "general_condition": null, "diagnosis": null, "work_performed": null, "estimated_value": null, "final_value": null, "internal_notes": null, "opened_at": "2026-08-21 12:00:00", "closed_at": null, "created_at": "2026-08-21 12:00:00", "updated_at": "2026-08-21 12:00:00"}],
            "history": [{"id": 11, "repair_id": 9, "status_id": 4, "changed_at": "2026-08-21 12:00:00", "note": null}]
        }}));
        restore_portable_connection(&mut connection, v1).unwrap();
        assert_eq!(connection.query_row("SELECT name FROM customers", [], |row| row.get::<_,String>(0)).unwrap(), "Portable customer");
        assert_eq!(connection.query_row("SELECT customer_type FROM customers", [], |row| row.get::<_,String>(0)).unwrap(), "residential");
        assert_eq!(connection.query_row("SELECT priority FROM repairs", [], |row| row.get::<_,String>(0)).unwrap(), "normal");
        connection.execute("INSERT INTO customers (name) VALUES ('Next')", []).unwrap();
        assert_eq!(connection.query_row("SELECT MAX(id) FROM customers", [], |row| row.get::<_,i64>(0)).unwrap(), 8);
    }

    #[test]
    fn portable_restore_of_version_2_keeps_profiles_and_parts() {
        let mut connection = test_database();
        let v2 = archive(serde_json::json!({ "format": "dbrepairs-portable", "version": 2, "createdAt": "2026-08-21T12:00:00Z", "sourceEngine": "postgresql", "data": {
            "settings": [],
            "statuses": [{"id": 1, "code": "RECEIVED", "label_key": "status.received", "sort_order": 10, "active": true}],
            "customers": [{"id": 3, "name": "Acme", "company": "Acme", "tax_number": null, "phone": null, "email": null, "address": null, "notes": null, "created_at": "2026-08-21T12:00:00Z", "updated_at": "2026-08-21T12:00:00Z",
                "customer_type": "commercial", "contact_person": "Jo", "mobile": null, "preferred_contact": "email", "tags": "vip", "is_retainer": true, "retainer_plan": "Gold", "retainer_monthly_fee": 250.0, "retainer_renewal_date": "2027-01-31"}],
            "repairs": [{"id": 5, "repair_number": "2026-000005", "customer_id": 3, "status_id": 1, "device_type": null, "brand": null, "model": null, "serial_number": null, "imei": null, "reported_fault": "x", "accessories": null, "general_condition": null, "diagnosis": null, "work_performed": null, "estimated_value": null, "final_value": null, "internal_notes": null, "opened_at": "2026-08-21T12:00:00Z", "closed_at": null, "created_at": "2026-08-21T12:00:00Z", "updated_at": "2026-08-21T12:00:00Z",
                "priority": "urgent", "due_date": "2026-09-01", "technician": "Sam", "deposit": 20.0, "paid": false, "warranty_days": 90}],
            "history": [],
            "parts": [{"id": 2, "repair_id": 5, "name": "Screen", "part_number": null, "supplier": "iFixit", "url": "https://www.ifixit.com/x", "quantity": 1, "unit_cost": 45.5, "status": "ordered", "notes": null, "ordered_at": "2026-08-22T12:00:00Z", "received_at": null, "created_at": "2026-08-21T12:00:00Z", "updated_at": "2026-08-21T12:00:00Z"}]
        }}));
        restore_portable_connection(&mut connection, v2).unwrap();
        assert_eq!(count(&connection, "SELECT is_retainer FROM customers WHERE id=3"), 1);
        assert_eq!(connection.query_row("SELECT url FROM repair_parts", [], |row| row.get::<_,String>(0)).unwrap(), "https://www.ifixit.com/x");
        connection.execute("INSERT INTO repair_parts (repair_id,name) VALUES (5,'Next')", []).unwrap();
        assert_eq!(count(&connection, "SELECT MAX(id) FROM repair_parts"), 3);
    }

    fn repair_fields(status_id: i64) -> RepairFields {
        RepairFields { customer_id:1, status_id, device_type:Some(" Laptop ".into()), brand:Some("".into()), model:None, serial_number:None, imei:None,
            reported_fault:Some("No power".into()), accessories:None, general_condition:None, estimated_value:Some(40.0), internal_notes:None,
            diagnosis:None, work_performed:None, final_value:None, priority:"high".into(), due_date:Some("2026-12-24".into()),
            technician:Some(" Sam ".into()), deposit:Some(10.0), paid:false, warranty_days:Some(90) }
    }

    fn test_database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(include_str!("../migrations/0001_initial.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/0002_shop_features.sql")).unwrap();
        connection.execute("INSERT INTO customers (name) VALUES ('Ana')", []).unwrap();
        connection
    }

    fn count(connection: &Connection, sql: &str) -> i64 { connection.query_row(sql, [], |row| row.get(0)).unwrap() }

    #[test]
    fn create_repair_saves_number_and_history_together() {
        let mut connection = test_database();
        let id = create_repair_record(&mut connection, repair_fields(1)).unwrap();
        let (number, device, brand): (String, Option<String>, Option<String>) = connection.query_row("SELECT repair_number, device_type, brand FROM repairs WHERE id=?1", params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert!(number.ends_with(&format!("-{id:06}")) && number.len() == 11, "unexpected number {number}");
        assert_eq!(device.as_deref(), Some("Laptop"));
        assert_eq!(brand, None);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repair_status_history"), 1);
    }

    #[test]
    fn create_repair_leaves_nothing_behind_when_it_fails() {
        let mut connection = test_database();
        let mut fields = repair_fields(1);
        fields.customer_id = 999;
        assert!(create_repair_record(&mut connection, fields).is_err());
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repairs"), 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repair_status_history"), 0);
        let mut negative = repair_fields(1);
        negative.estimated_value = Some(-1.0);
        assert!(create_repair_record(&mut connection, negative).is_err());
    }

    #[test]
    fn update_repair_records_status_changes_and_closes_repairs() {
        let mut connection = test_database();
        let id = create_repair_record(&mut connection, repair_fields(1)).unwrap();
        let delivered = count(&connection, "SELECT id FROM repair_statuses WHERE code='DELIVERED'");
        update_repair_record(&mut connection, id, repair_fields(delivered), Some(" Collected ".into())).unwrap();
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repairs WHERE closed_at IS NOT NULL"), 1);
        assert_eq!(connection.query_row("SELECT note FROM repair_status_history ORDER BY id DESC LIMIT 1", [], |row| row.get::<_,String>(0)).unwrap(), "Collected");
        update_repair_record(&mut connection, id, repair_fields(delivered), None).unwrap();
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repair_status_history"), 2);
        assert!(update_repair_record(&mut connection, 999, repair_fields(1), None).is_err());
    }

    #[test]
    fn create_repair_stores_workflow_fields_and_rejects_bad_ones() {
        let mut connection = test_database();
        let id = create_repair_record(&mut connection, repair_fields(1)).unwrap();
        let (priority, due, tech): (String, String, String) = connection.query_row("SELECT priority, due_date, technician FROM repairs WHERE id=?1", params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!((priority.as_str(), due.as_str(), tech.as_str()), ("high", "2026-12-24", "Sam"));
        let mut bad = repair_fields(1); bad.priority = "asap".into();
        assert!(create_repair_record(&mut connection, bad).is_err());
        let mut bad_date = repair_fields(1); bad_date.due_date = Some("24/12/2026".into());
        assert!(create_repair_record(&mut connection, bad_date).is_err());
    }

    #[test]
    fn delete_repair_removes_parts_and_history() {
        let mut connection = test_database();
        let id = create_repair_record(&mut connection, repair_fields(1)).unwrap();
        connection.execute("INSERT INTO repair_parts (repair_id,name) VALUES (?1,'Battery')", params![id]).unwrap();
        delete_repair_record(&mut connection, id).unwrap();
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repairs"), 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repair_parts"), 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM repair_status_history"), 0);
        assert!(delete_repair_record(&mut connection, id).is_err());
    }

    #[test]
    fn snapshot_copies_a_database_file() {
        let dir = std::env::temp_dir().join(format!("dbrepairs-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.db");
        let destination = dir.join("copy.db");
        let connection = Connection::open(&source).unwrap();
        connection.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (42);").unwrap();
        snapshot_database(&source, &destination).unwrap();
        assert!(is_sqlite_database(&fs::read(&destination).unwrap()));
        assert_eq!(count(&Connection::open(&destination).unwrap(), "SELECT x FROM t"), 42);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_filenames_must_be_plain_names() {
        assert!(is_safe_filename("DBRepairs-clientes.csv"));
        for name in ["", "../x.csv", "a/b.csv", "a\\b.csv", "C:evil.csv", ".hidden", "name with space.csv"] {
            assert!(!is_safe_filename(name), "{name} should be rejected");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "shop_features",
            sql: include_str!("../migrations/0002_shop_features.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:dbrepairs.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![backup_database, restore_database, export_text_file, restore_portable_database, create_repair, update_repair, delete_repair])
        .setup(|app| {
            apply_pending_restore(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run DBRepairs");
}
