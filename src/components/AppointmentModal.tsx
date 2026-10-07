import { useEffect, useState } from "react";
import Modal from "./Modal";
import { Appointment, AppointmentInput, appointmentKinds, createAppointment, deleteAppointment, updateAppointment } from "../data/shopfloor";
import { Customer, listCustomers } from "../data/customers";
import { listUsers, TeamUser } from "../data/users";
import { listRepairsByCustomer, Repair } from "../data/repairs";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";

/** "2026-10-08T09:30" in local time, for <input type="datetime-local">. */
export const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function AppointmentModal({ appointment, initial, onClose, onSaved }: {
  appointment: Appointment | null; initial?: Partial<AppointmentInput>; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { user, isAdmin } = useSession();
  const start = appointment ? new Date(appointment.starts_at) : initial?.starts_at ? new Date(initial.starts_at) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
  const [form, setForm] = useState({
    title: appointment?.title ?? initial?.title ?? "", kind: appointment?.kind ?? initial?.kind ?? "onsite",
    customer_id: appointment?.customer_id ?? initial?.customer_id ?? null, repair_id: appointment?.repair_id ?? initial?.repair_id ?? null,
    user_id: appointment ? appointment.user_id : initial?.user_id ?? user?.id ?? null,
    start: toLocalInput(start),
    duration: String(appointment ? Math.round((new Date(appointment.ends_at).getTime() - start.getTime()) / 60000) : 60),
    all_day: appointment?.all_day ?? false, address: appointment?.address ?? initial?.address ?? "", travel_minutes: appointment?.travel_minutes?.toString() ?? "",
    notes: appointment?.notes ?? "", status: appointment?.status ?? "scheduled",
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    listCustomers().then(setCustomers).catch(() => {});
    if (isAdmin) listUsers().then((list) => setUsers(list.filter((u) => u.active))).catch(() => {});
  }, []);
  useEffect(() => { if (form.customer_id) listRepairsByCustomer(form.customer_id).then(setRepairs).catch(() => {}); else setRepairs([]); }, [form.customer_id]);

  function chooseCustomer(id: number | null) {
    const customer = customers.find((c) => c.id === id);
    setForm((f) => ({ ...f, customer_id: id, repair_id: null, address: f.address || customer?.address || "", title: f.title || (customer ? customer.name : "") }));
  }

  async function save() {
    const starts = new Date(form.start);
    const ends = form.all_day ? new Date(starts.getFullYear(), starts.getMonth(), starts.getDate(), 23, 59) : new Date(starts.getTime() + (Number(form.duration) || 60) * 60000);
    if (form.all_day) starts.setHours(0, 0, 0, 0);
    const input: AppointmentInput = {
      title: form.title, kind: form.kind, customer_id: form.customer_id, repair_id: form.repair_id, asset_id: null, user_id: form.user_id,
      starts_at: starts.toISOString(), ends_at: ends.toISOString(), all_day: form.all_day, address: form.address || null,
      travel_minutes: form.travel_minutes ? Number(form.travel_minutes) : null, notes: form.notes || null, status: form.status,
    };
    try { if (appointment) await updateAppointment(appointment.id, input); else await createAppointment(input); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  async function remove() {
    if (!appointment || !window.confirm(t("schedule.deleteConfirm"))) return;
    try { await deleteAppointment(appointment.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={appointment ? t("schedule.edit") : t("schedule.add")} onClose={onClose} wide
      footer={<>{appointment && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={!form.title.trim() || !form.start} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field full"><span>{t("schedule.title")} *</span><input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("schedule.titlePlaceholder")} /></label>
          <label className="field"><span>{t("schedule.kind")}</span><select value={form.kind} onChange={(e) => set("kind", e.target.value as AppointmentInput["kind"])}>
            {appointmentKinds.map((k) => <option key={k} value={k}>{t(`schedule.kind.${k}`)}</option>)}</select></label>
          {isAdmin ? <label className="field"><span>{t("time.technician")}</span><select value={form.user_id ?? ""} onChange={(e) => set("user_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t("schedule.anyone")}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label> : <div />}
          <label className="field"><span>{t("schedule.start")}</span><input type={form.all_day ? "date" : "datetime-local"} value={form.all_day ? form.start.slice(0, 10) : form.start}
            onChange={(e) => set("start", form.all_day ? `${e.target.value}T00:00` : e.target.value)} /></label>
          {!form.all_day ? <label className="field"><span>{t("schedule.duration")}</span><select value={form.duration} onChange={(e) => set("duration", e.target.value)}>
            {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select></label> : <div />}
          <label className="check"><input type="checkbox" checked={form.all_day} onChange={(e) => set("all_day", e.target.checked)} />{t("schedule.allDay")}</label>
          <label className="field"><span>{t("billing.state")}</span><select value={form.status} onChange={(e) => set("status", e.target.value as AppointmentInput["status"])}>
            {(["scheduled", "done", "cancelled"] as const).map((s) => <option key={s} value={s}>{t(`schedule.status.${s}`)}</option>)}</select></label>
          <label className="field"><span>{t("repair.customer")}</span><select value={form.customer_id ?? ""} onChange={(e) => chooseCustomer(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>)}</select></label>
          <label className="field"><span>{t("repair.number")}</span><select value={form.repair_id ?? ""} disabled={!form.customer_id} onChange={(e) => set("repair_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>{repairs.map((r) => <option key={r.id} value={r.id}>{r.repair_number}</option>)}</select></label>
          <label className="field full"><span>{t("schedule.address")}</span><input value={form.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="field"><span>{t("schedule.travel")}</span><input type="number" min="0" max="1440" value={form.travel_minutes} onChange={(e) => set("travel_minutes", e.target.value)} /></label>
          <label className="field full"><span>{t("part.notes")}</span><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
