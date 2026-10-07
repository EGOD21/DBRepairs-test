import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { ChecklistTemplate, createTemplate, deleteTemplate, listTemplates, updateTemplate } from "../data/comms";
import { useI18n } from "../i18n/I18nProvider";

type Draft = Omit<ChecklistTemplate, "id">;
const blank: Draft = { name: "", device_type: "", items: "", active: true };

/** Admins write the step lists technicians tick off on a repair (e.g. "Laptop diagnostic"). */
export default function ChecklistTemplateSettings() {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [editing, setEditing] = useState<{ id?: number; draft: Draft } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => listTemplates().then(setTemplates).catch((e) => setError(String(e?.message ?? e)));
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      if (editing.id) await updateTemplate(editing.id, editing.draft); else await createTemplate(editing.draft);
      setEditing(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(template: ChecklistTemplate) {
    if (!window.confirm(t("checklist.deleteConfirm"))) return;
    try { await deleteTemplate(template.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setEditing((current) => current && { ...current, draft: { ...current.draft, [key]: value } });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && !editing && <div className="alert error">{error}</div>}
      {templates.length === 0 ? <p className="hint">{t("checklist.noTemplates")}</p> : (
        <ul className="list-rows">
          {templates.map((template) => (
            <li key={template.id} className="list-row">
              <div>
                <strong>{template.name}</strong>{!template.active && <span className="badge" style={{ marginLeft: 8 }}>{t("checklist.inactive")}</span>}
                <div className="hint">{[template.device_type, `${template.items.split("\n").filter(Boolean).length} ${t("checklist.steps")}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="page-actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: template.id, draft: { name: template.name, device_type: template.device_type ?? "", items: template.items, active: template.active } })}>{t("common.edit")}</button>
                <button type="button" className="btn btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => void remove(template)}><Icon name="trash" size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div><button type="button" className="btn" onClick={() => setEditing({ draft: { ...blank } })}><Icon name="plus" size={15} />{t("checklist.newTemplate")}</button></div>
      {editing && (
        <Modal title={editing.id ? t("checklist.editTemplate") : t("checklist.newTemplate")} onClose={() => setEditing(null)}
          footer={<>
            <button type="button" className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !editing.draft.name.trim() || !editing.draft.items.trim()} onClick={() => void save()}>{t("common.save")}</button>
          </>}>
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <label className="field"><span>{t("checklist.name")}</span><input autoFocus value={editing.draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t("checklist.namePlaceholder")} /></label>
            <label className="field"><span>{t("checklist.deviceType")}</span><input value={editing.draft.device_type ?? ""} onChange={(e) => set("device_type", e.target.value)} placeholder={t("checklist.deviceTypePlaceholder")} /><small>{t("checklist.deviceTypeHint")}</small></label>
            <label className="field full"><span>{t("checklist.items")}</span><textarea rows={10} value={editing.draft.items} onChange={(e) => set("items", e.target.value)} placeholder={t("checklist.itemsPlaceholder")} /><small>{t("checklist.itemsHint")}</small></label>
            <label className="check full"><input type="checkbox" checked={editing.draft.active} onChange={(e) => set("active", e.target.checked)} />{t("checklist.active")}</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
