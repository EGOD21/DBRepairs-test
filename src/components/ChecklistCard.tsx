import { useEffect, useState } from "react";
import Icon from "./Icon";
import { addRepairChecklist, ChecklistTemplate, listRepairChecklists, listTemplates, removeRepairChecklist, RepairChecklist, suggestedArticles, tickChecklist } from "../data/comms";
import { Repair } from "../data/repairs";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

/** Step-by-step checklists on a repair (diagnostics, QC before return) plus help articles that match the device. */
export default function ChecklistCard({ repair }: { repair: Repair }) {
  const { t } = useI18n();
  const [lists, setLists] = useState<RepairChecklist[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [articles, setArticles] = useState<{ id: number; title: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listRepairChecklists(repair.id).then(setLists).catch(() => {});
    listTemplates().then((all) => setTemplates(all.filter((tpl) => tpl.active))).catch(() => {});
    suggestedArticles(repair.id).then(setArticles).catch(() => {});
  }, [repair.id]);

  // Templates for this device type first.
  const device = (repair.device_type ?? "").toLowerCase();
  const sorted = [...templates].sort((a, b) => Number(Boolean(b.device_type && device.includes(b.device_type.toLowerCase()))) - Number(Boolean(a.device_type && device.includes(a.device_type.toLowerCase()))));

  async function add(templateId: number) {
    try { const created = await addRepairChecklist(repair.id, templateId); setLists((current) => [...current, created]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  async function tick(list: RepairChecklist, index: number, done: boolean) {
    try { const updated = await tickChecklist(list.id, index, done); setLists((current) => current.map((l) => (l.id === updated.id ? updated : l))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  async function remove(list: RepairChecklist) {
    if (!window.confirm(t("checklist.removeConfirm"))) return;
    try { await removeRepairChecklist(list.id); setLists((current) => current.filter((l) => l.id !== list.id)); } catch { setError(t("common.saveError")); }
  }

  if (!templates.length && !lists.length && !articles.length) return null;
  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("checklist.title")}</h2></div>
        {sorted.length > 0 && (
          <select className="input" style={{ width: "auto", minHeight: 30 }} value="" onChange={(e) => { if (e.target.value) void add(Number(e.target.value)); }} aria-label={t("checklist.add")}>
            <option value="">{t("checklist.add")}</option>{sorted.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        )}
      </div>
      <div className="card-body" style={{ display: "grid", gap: 16 }}>
        {error && <div className="alert error">{error}</div>}
        {articles.length > 0 && (
          <div className="kb-suggest"><Icon name="book" size={15} /><span>{t("kb.suggested")}:</span>
            {articles.map((a) => <a key={a.id} href={href({ name: "knowledge", id: a.id })}>{a.title}</a>)}</div>
        )}
        {lists.map((list) => {
          const done = list.items.filter((item) => item.done).length;
          return (
            <div key={list.id} className="checklist-block">
              <div className="title-row"><strong>{list.name}</strong><span className={`badge ${done === list.items.length ? "success" : ""}`}>{done} / {list.items.length}</span>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" style={{ marginLeft: "auto" }} onClick={() => void remove(list)} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button></div>
              {list.items.map((item, index) => (
                <label key={index} className={`check checklist-item${item.done ? " done" : ""}`}>
                  <input type="checkbox" checked={item.done} onChange={(e) => void tick(list, index, e.target.checked)} />
                  <span>{item.label}{item.done && item.by && <small className="muted"> · {item.by}{item.at ? `, ${new Date(item.at).toLocaleString()}` : ""}</small>}{item.note && <small className="muted"> — {item.note}</small>}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
