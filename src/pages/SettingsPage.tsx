import { ChangeEvent, createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Icon, { IconName } from "../components/Icon";
import LanguageDropdown from "../components/LanguageDropdown";
import { useI18n } from "../i18n/I18nProvider";
import { useBranding } from "../branding";
import { AppSettings, emptySettings, getSettings, prepareLogo, saveSettings, SettingKey } from "../data/settings";
import { getDatabase } from "../data/database";
import { listCustomers } from "../data/customers";
import { listRepairs } from "../data/repairs";
import { downloadApiFile, downloadTextFile, restoreApiBackup } from "../data/api";
import { isServerMode } from "../data/runtime";
import { exportPortableBackup, importPortableBackup, parsePortableBackup } from "../data/portable";
import { fontOptions, hubspotTheme, isSafeThemeValue, parseTheme, radiusOptions, Theme, ThemeField, themeFields, themePresets } from "../theme/theme";
import { defaultLabelSize, labelSizes } from "../print/types";
import { useSession } from "../session";
import { fill } from "../lib/format";
import { defaultChecklist } from "../data/records";
import { emptyAppIcons, makeAppIcons } from "../lib/appIcons";
import { MyAccountSection, TeamSection } from "../components/TeamSettings";
import StorageSettings from "../components/StorageSettings";
import AuditLogSettings from "../components/AuditLogSettings";
import PushToggle from "../components/PushToggle";
import ChecklistTemplateSettings from "../components/ChecklistTemplateSettings";
import { defaultTemplates, messagingStatus, MessagingStatus } from "../data/comms";
import { href } from "../router";

type Notice = { tone: "success" | "error"; text: string } | null;

// Each settings section is its own page (#/settings/<id>); only the open one renders.
const OpenSection = createContext("");

function Section({ id, icon, title, hint, children, footer }: { id: string; icon: IconName; title: string; hint?: string; children: ReactNode; footer?: ReactNode }) {
  if (useContext(OpenSection) !== id) return null;
  return (
    <section className="card" id={id}>
      <div className="card-header"><div><h2 className="title-row"><Icon name={icon} size={17} />{title}</h2>{hint && <p>{hint}</p>}</div></div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  // Spreadsheet apps run cells starting with these characters as formulas.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export default function SettingsPage({ section }: { section?: string }) {
  const { t, locale, setLocale, locales } = useI18n();
  const branding = useBranding();
  const { isAdmin, teamFeatures } = useSession();
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [saved, setSaved] = useState<AppSettings>(emptySettings);
  const [theme, setTheme] = useState<Theme>(branding.theme);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s); setSaved(s); setTheme(parseTheme(s["ui.theme"]));
      // Logos saved before app icons existed get their home-screen icons now.
      if (isServerMode && isAdmin && s["office.logoDataUrl"] && !s["app.icon512"]) {
        makeAppIcons(s["office.logoDataUrl"], parseTheme(s["ui.theme"]).surface)
          .then((icons) => saveSettings(icons).then(() => setSaved((current) => ({ ...current, ...icons }))))
          .catch((cause) => console.error("Could not create app icons:", cause));
      }
    }).catch(() => setNotice({ tone: "error", text: t("common.databaseError") }));
    return () => branding.previewTheme(null);
  }, []);

  useEffect(() => { branding.previewTheme(theme); }, [theme]);

  const set = (key: SettingKey, value: string) => setSettings((s) => ({ ...s, [key]: value }));
  const changed = (keys: SettingKey[]) => keys.some((key) => settings[key] !== saved[key]);
  const savedTheme = useMemo(() => parseTheme(saved["ui.theme"]), [saved]);
  const themeChanged = JSON.stringify(theme) !== JSON.stringify(savedTheme);

  async function persist(keys: SettingKey[], values: Partial<AppSettings> = {}) {
    const payload = Object.fromEntries(keys.map((key) => [key, values[key] ?? settings[key]])) as Partial<AppSettings>;
    setBusy(keys[0]); setNotice(null);
    try {
      await saveSettings(payload);
      setSaved((s) => ({ ...s, ...payload }));
      setSettings((s) => ({ ...s, ...payload }));
      await branding.refresh();
      setNotice({ tone: "success", text: t("settings.saved") });
      return true;
    } catch (cause) {
      console.error(cause);
      setNotice({ tone: "error", text: cause instanceof Error && cause.message ? cause.message : t("common.saveError") });
      return false;
    } finally {
      setBusy("");
    }
  }

  async function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setNotice({ tone: "error", text: t("settings.logoTooLarge") }); return; }
    try {
      const logo = await prepareLogo(file);
      const icons = isServerMode ? await makeAppIcons(logo, savedTheme.surface) : null;
      await persist(["office.logoDataUrl", ...(icons ? Object.keys(icons) as SettingKey[] : [])], { "office.logoDataUrl": logo, ...icons });
    } catch {
      setNotice({ tone: "error", text: t("settings.logoInvalid") });
    }
  }

  async function saveTheme() {
    // The icons' solid background follows the theme's card color.
    const logo = saved["office.logoDataUrl"];
    const icons = isServerMode && logo ? await makeAppIcons(logo, theme.surface).catch(() => null) : null;
    const keys: SettingKey[] = ["ui.theme", ...(icons ? Object.keys(icons) as SettingKey[] : [])];
    if (await persist(keys, { "ui.theme": JSON.stringify(theme), ...icons })) branding.previewTheme(null);
  }

  const businessKeys: SettingKey[] = ["office.companyName", "office.taxNumber", "office.address", "office.phone", "office.email", "office.website"];
  const printKeys: SettingKey[] = ["print.autoPrint", "print.labelSize", "print.terms"];
  const notifyKeys: SettingKey[] = ["notify.received", "notify.receivedSubject", "notify.receivedBody", "notify.receivedSms", "notify.ready", "notify.readySubject", "notify.readyBody", "notify.readySms", "status.enabled", "status.publicUrl", "status.language"];
  const intakeKeys: SettingKey[] = ["intake.checklist", "intake.waiver", "vault.techAccess", "wipe.prefix", "wipe.statement", "unclaimed.days"];
  const billingKeys: SettingKey[] = ["billing.currency", "billing.hourlyRate", "billing.taxLabel", "billing.taxRate", "billing.timeRounding", "billing.paymentTermsDays",
    "billing.invoicePrefix", "billing.estimatePrefix", "billing.estimateValidDays", "billing.invoiceNotes", "billing.paymentInstructions", "billing.paymentLink"];
  const groups = useMemo(() => {
    const byGroup = new Map<string, ThemeField[]>();
    for (const field of themeFields) byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    return Array.from(byGroup.entries());
  }, []);

  // ---- Data: native backups, portable backups and CSV exports ----
  async function nativeBackup() {
    if (isServerMode) return downloadApiFile("/backups/database");
    const db = await getDatabase();
    await db.execute("PRAGMA wal_checkpoint(FULL)");
    return invoke<string>("backup_database");
  }

  async function run(label: string, action: () => Promise<string | void>) {
    if (busy) return;
    setBusy(label); setNotice(null);
    try {
      const result = await action();
      setNotice({ tone: "success", text: result ? `${t("settings.done")} ${result}` : t("settings.done") });
    } catch (cause) {
      console.error(cause);
      setNotice({ tone: "error", text: t("settings.actionError") });
    } finally {
      setBusy("");
    }
  }

  async function restoreNative(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = isServerMode ? ".dump" : ".db";
    if (!file.name.toLowerCase().endsWith(extension)) { setNotice({ tone: "error", text: t(isServerMode ? "settings.restoreServerInvalid" : "settings.restoreInvalid") }); return; }
    if (!window.confirm(t(isServerMode ? "settings.restoreServerConfirm" : "settings.restoreConfirm"))) return;
    await run("restore", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isServerMode) {
        if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "PGDMP") throw new Error("invalid");
        await downloadApiFile("/backups/database");
        await restoreApiBackup(bytes.buffer);
        window.location.reload();
        return;
      }
      if (new TextDecoder("utf-8").decode(bytes.slice(0, 16)) !== "SQLite format 3\0") throw new Error("invalid");
      const db = await getDatabase();
      await db.execute("PRAGMA wal_checkpoint(FULL)");
      await invoke("restore_database", bytes);
    });
  }

  async function restorePortable(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let archive;
    try { archive = parsePortableBackup(await file.text()); } catch { setNotice({ tone: "error", text: t("settings.portableInvalid") }); return; }
    if (!window.confirm(t("settings.portableConfirm"))) return;
    await run("portable-restore", async () => {
      await nativeBackup();
      await importPortableBackup(archive);
      window.location.reload();
    });
  }

  async function exportCsv(kind: "customers" | "repairs") {
    await run(`csv-${kind}`, async () => {
      let rows: unknown[][];
      let header: string[];
      if (kind === "customers") {
        header = ["ID", t("customer.name"), t("customer.type"), t("customer.company"), t("customer.contactPerson"), t("customer.taxNumber"), t("customer.phone"), t("customer.mobile"), t("customer.email"), t("customer.address"), t("customer.retainer"), t("customer.retainerPlan"), t("customer.retainerMonthlyFee"), t("customer.tags"), t("customer.notes"), t("customers.repairs"), t("customers.billed"), t("customer.since")];
        rows = (await listCustomers()).map((c) => [c.id, c.name, t(`customer.type.${c.customer_type}`), c.company, c.contact_person, c.tax_number, c.phone, c.mobile, c.email, c.address, c.is_retainer ? "✓" : "", c.retainer_plan, c.retainer_monthly_fee, c.tags, c.notes, c.repair_count, c.total_billed, c.created_at]);
      } else {
        header = ["ID", t("repair.number"), t("repair.customer"), t("repair.status"), t("repair.priority"), t("repair.deviceType"), t("repair.brand"), t("repair.model"), t("repair.serialNumber"), t("repair.imei"), t("repair.reportedFault"), t("repair.accessories"), t("repair.generalCondition"), t("repair.diagnosis"), t("repair.workPerformed"), t("repair.technician"), t("repair.dueDate"), t("repair.estimatedValue"), t("repair.finalValue"), t("repair.deposit"), t("repair.paid"), t("repair.warrantyDays"), t("repair.internalNotes"), t("repair.openedAt"), t("repair.closedAt")];
        rows = (await listRepairs()).map((r) => [r.id, r.repair_number, r.customer_name, t(r.status_label_key), t(`priority.${r.priority}`), r.device_type, r.brand, r.model, r.serial_number, r.imei, r.reported_fault, r.accessories, r.general_condition, r.diagnosis, r.work_performed, r.technician, r.due_date, r.estimated_value, r.final_value, r.deposit, r.paid ? "✓" : "", r.warranty_days, r.internal_notes, r.opened_at, r.closed_at]);
      }
      const csv = "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
      const filename = `DBRepairs-${kind}.csv`;
      if (isServerMode) { downloadTextFile(csv, filename); return filename; }
      return invoke<string>("export_text_file", { filename, content: csv });
    });
  }

  // Techs only see their own account and language; admins see everything.
  const nav: [string, IconName, string][] = [
    ...(teamFeatures ? [["account", "users", t("account.title")] as [string, IconName, string]] : []),
    ...(isAdmin ? [["business", "building", t("settings.office")], ["appearance", "palette", t("settings.appearance")], ["printing", "printer", t("settings.printing")],
      ["email", "mail", t("settings.emailSection")]] as [string, IconName, string][] : []),
    ...(isAdmin && teamFeatures ? [["team", "users", t("team.title")] as [string, IconName, string]] : []),
    ...(isAdmin && isServerMode ? [["billing", "receipt", t("settings.billing")], ["intake", "lock", t("settings.intake")], ["notifications", "bell", t("settings.notifications")], ["checklists", "check", t("checklist.templates")], ["storage", "hardDrive", t("storage.title")],
      ["activity", "activity", t("activity.title")]] as [string, IconName, string][] : []),
    ["language", "globe", t("settings.language")],
    ...(isAdmin ? [["data", "database", t("settings.data")] as [string, IconName, string]] : []),
  ];

  // Admins start on the business details; techs on their own account.
  const open = nav.some(([id]) => id === section) ? section! : (nav.find(([id]) => id === "business") ?? nav[0])[0];
  const openLabel = nav.find(([id]) => id === open)?.[2] ?? "";

  return (
    <div className="page">
      <header className="page-header"><div><h1>{t("settings.title")}<span className="muted settings-crumb"> / {openLabel}</span></h1><p>{t("settings.subtitle")}</p></div></header>
      {notice && <div className={`alert ${notice.tone}`} role="status">{notice.text}</div>}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {nav.map(([id, icon, label]) => (
            <a key={id} href={href({ name: "settings", section: id })} className={id === open ? "active" : ""} aria-current={id === open ? "page" : undefined}><Icon name={icon} size={16} />{label}</a>
          ))}
        </nav>
        <div className="settings-sections">
          <OpenSection.Provider value={open}>
          {teamFeatures && <Section id="account" icon="users" title={t("account.title")}><div style={{ display: "grid", gap: 24 }}><MyAccountSection /><PushToggle /></div></Section>}
          {isAdmin && <>
          <Section id="business" icon="building" title={t("settings.office")} hint={t("settings.officeHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(businessKeys) || busy !== ""} onClick={() => void persist(businessKeys)}>{t("common.saveChanges")}</button>}>
            <div className="form-grid">
              <div className="field full">
                <span>{t("settings.logo")}</span>
                <div className="logo-row">
                  <div className="logo-preview"><img src={branding.logo} alt="" /></div>
                  <div className="page-actions">
                    <label className="btn file-button"><Icon name="plus" size={15} />{t("settings.chooseLogo")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void chooseLogo(e)} /></label>
                    {settings["office.logoDataUrl"] && <button type="button" className="btn btn-danger" onClick={() => void persist(["office.logoDataUrl", ...(isServerMode ? Object.keys(emptyAppIcons) as SettingKey[] : [])], { "office.logoDataUrl": "", ...emptyAppIcons })}>{t("settings.removeLogo")}</button>}
                  </div>
                  <small className="hint">{t("settings.logoHint")}</small>
                </div>
              </div>
              <label className="field full"><span>{t("settings.companyName")}</span><input value={settings["office.companyName"]} onChange={(e) => set("office.companyName", e.target.value)} /></label>
              <label className="field"><span>{t("settings.taxNumber")}</span><input value={settings["office.taxNumber"]} onChange={(e) => set("office.taxNumber", e.target.value)} /></label>
              <label className="field"><span>{t("settings.phone")}</span><input value={settings["office.phone"]} onChange={(e) => set("office.phone", e.target.value)} /></label>
              <label className="field"><span>{t("settings.email")}</span><input type="email" value={settings["office.email"]} onChange={(e) => set("office.email", e.target.value)} /></label>
              <label className="field"><span>{t("settings.website")}</span><input value={settings["office.website"]} onChange={(e) => set("office.website", e.target.value)} /></label>
              <label className="field full"><span>{t("settings.address")}</span><input value={settings["office.address"]} onChange={(e) => set("office.address", e.target.value)} /></label>
            </div>
          </Section>

          <Section id="appearance" icon="palette" title={t("settings.appearance")} hint={t("settings.appearanceHint")}
            footer={<>
              <button type="button" className="btn" onClick={() => setTheme(hubspotTheme)}>{t("settings.resetTheme")}</button>
              <button type="button" className="btn" disabled={!themeChanged} onClick={() => setTheme(savedTheme)}>{t("common.cancel")}</button>
              <button type="button" className="btn btn-primary" disabled={!themeChanged || busy !== ""} onClick={() => void saveTheme()}>{t("settings.saveTheme")}</button>
            </>}>
            <div style={{ display: "grid", gap: 16 }}>
              <div className="theme-presets">
                {themePresets.map((preset) => (
                  <button key={preset.id} type="button" className={`preset${JSON.stringify(preset.theme) === JSON.stringify(theme) ? " active" : ""}`} onClick={() => setTheme(preset.theme)}>
                    <div className="preset-swatches">{[preset.theme.sidebar, preset.theme.background, preset.theme.primary, preset.theme.accent].map((c, i) => <span key={i} style={{ background: c }} />)}</div>
                    <strong style={{ fontSize: 13 }}>{preset.label}</strong>
                  </button>
                ))}
              </div>
              {groups.map(([group, fields]) => (
                <div key={group} style={{ display: "grid", gap: 8 }}>
                  <div className="theme-group-title">{t(`theme.group.${group}`)}</div>
                  <div className="color-grid">
                    {fields.map((field) => <ThemeInput key={field.key} field={field} value={theme[field.key]} label={t(`theme.${field.key}`)} customLabel={t("theme.customFont")}
                      onChange={(value) => { if (isSafeThemeValue(value)) setTheme((current) => ({ ...current, [field.key]: value })); }} />)}
                  </div>
                </div>
              ))}
              <p className="hint">{t("settings.themePreviewHint")}</p>
            </div>
          </Section>

          <Section id="printing" icon="printer" title={t("settings.printing")} hint={t("settings.printingHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(printKeys) || busy !== ""} onClick={() => void persist(printKeys)}>{t("common.saveChanges")}</button>}>
            <div className="form-grid">
              <label className="field"><span>{t("settings.autoPrint")}</span>
                <select value={settings["print.autoPrint"] || "none"} onChange={(e) => set("print.autoPrint", e.target.value)}>
                  <option value="none">{t("settings.autoPrint.none")}</option>
                  <option value="intake">{t("print.kind.intake")}</option>
                  <option value="label">{t("print.kind.label")}</option>
                  <option value="receipt">{t("print.kind.receipt")}</option>
                </select>
                <small>{t("settings.autoPrintHint")}</small>
              </label>
              <label className="field"><span>{t("settings.labelSize")}</span>
                <select value={settings["print.labelSize"] || defaultLabelSize} onChange={(e) => set("print.labelSize", e.target.value)}>
                  {Object.entries(labelSizes).map(([key, size]) => <option key={key} value={key}>{size.label}</option>)}
                </select>
                <small>{t("settings.labelSizeHint")}</small>
              </label>
              <label className="field full"><span>{t("settings.terms")}</span><textarea rows={4} value={settings["print.terms"]} onChange={(e) => set("print.terms", e.target.value)} placeholder={t("settings.termsPlaceholder")} /><small>{t("settings.termsHint")}</small></label>
            </div>
          </Section>

          <Section id="email" icon="mail" title={t("settings.emailSection")} hint={t("settings.emailHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(["email.signature"]) || busy !== ""} onClick={() => void persist(["email.signature"])}>{t("common.saveChanges")}</button>}>
            <label className="field"><span>{t("settings.signature")}</span><textarea rows={4} value={settings["email.signature"]} onChange={(e) => set("email.signature", e.target.value)} placeholder={[settings["office.companyName"], settings["office.phone"]].filter(Boolean).join("\n")} /></label>
          </Section>

          {teamFeatures && <Section id="team" icon="users" title={t("team.title")} hint={t("team.hint")}><TeamSection /></Section>}
          {isServerMode && <Section id="billing" icon="receipt" title={t("settings.billing")} hint={t("settings.billingHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(billingKeys) || busy !== ""} onClick={() => void persist(billingKeys)}>{t("common.saveChanges")}</button>}>
            <div className="form-grid">
              <label className="field"><span>{t("settings.currency")}</span>
                <input value={settings["billing.currency"]} maxLength={3} placeholder="USD" onChange={(e) => set("billing.currency", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
                <small>{t("settings.currencyHint")}</small></label>
              <label className="field"><span>{t("settings.hourlyRate")}</span><input type="number" min="0" step="0.01" value={settings["billing.hourlyRate"]} onChange={(e) => set("billing.hourlyRate", e.target.value)} /></label>
              <label className="field"><span>{t("settings.taxLabel")}</span><input value={settings["billing.taxLabel"]} placeholder={t("billing.tax")} onChange={(e) => set("billing.taxLabel", e.target.value)} /></label>
              <label className="field"><span>{t("settings.taxRate")}</span><input type="number" min="0" max="100" step="0.001" value={settings["billing.taxRate"]} onChange={(e) => set("billing.taxRate", e.target.value)} /></label>
              <label className="field"><span>{t("settings.timeRounding")}</span>
                <select value={settings["billing.timeRounding"] || "1"} onChange={(e) => set("billing.timeRounding", e.target.value)}>
                  {["1", "5", "6", "10", "15", "30"].map((step) => <option key={step} value={step}>{step === "1" ? t("settings.timeRoundingNone") : fill(t("settings.timeRoundingStep"), { minutes: step })}</option>)}
                </select><small>{t("settings.timeRoundingHint")}</small></label>
              <label className="field"><span>{t("settings.paymentTerms")}</span><input type="number" min="0" max="365" value={settings["billing.paymentTermsDays"]} placeholder="14" onChange={(e) => set("billing.paymentTermsDays", e.target.value)} /></label>
              <label className="field"><span>{t("settings.invoicePrefix")}</span><input value={settings["billing.invoicePrefix"]} placeholder="INV-" onChange={(e) => set("billing.invoicePrefix", e.target.value)} /></label>
              <label className="field"><span>{t("settings.estimatePrefix")}</span><input value={settings["billing.estimatePrefix"]} placeholder="EST-" onChange={(e) => set("billing.estimatePrefix", e.target.value)} /></label>
              <label className="field"><span>{t("settings.estimateValid")}</span><input type="number" min="0" max="365" value={settings["billing.estimateValidDays"]} placeholder="30" onChange={(e) => set("billing.estimateValidDays", e.target.value)} /></label>
              <label className="field full"><span>{t("settings.invoiceNotes")}</span><textarea rows={2} value={settings["billing.invoiceNotes"]} onChange={(e) => set("billing.invoiceNotes", e.target.value)} placeholder={t("settings.invoiceNotesPlaceholder")} /></label>
              <label className="field full"><span>{t("settings.paymentInstructions")}</span><textarea rows={3} value={settings["billing.paymentInstructions"]} onChange={(e) => set("billing.paymentInstructions", e.target.value)} placeholder={t("settings.paymentInstructionsPlaceholder")} /></label>
              <label className="field full"><span>{t("settings.paymentLink")}</span><input value={settings["billing.paymentLink"]} onChange={(e) => set("billing.paymentLink", e.target.value)} placeholder="https://buy.stripe.com/…?prefilled_amount={amount}&client_reference_id={number}" />
                <small>{t("settings.paymentLinkHint")}</small></label>
            </div>
          </Section>}
          {isServerMode && <Section id="intake" icon="lock" title={t("settings.intake")} hint={t("settings.intakeHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(intakeKeys) || busy !== ""} onClick={() => void persist(intakeKeys)}>{t("common.saveChanges")}</button>}>
            <div className="form-grid">
              <label className="field full"><span>{t("settings.intakeChecklist")}</span>
                <textarea rows={7} value={settings["intake.checklist"]} onChange={(e) => set("intake.checklist", e.target.value)} placeholder={defaultChecklist} />
                <small>{t("settings.intakeChecklistHint")}</small></label>
              <label className="field full"><span>{t("settings.intakeWaiver")}</span>
                <textarea rows={5} value={settings["intake.waiver"]} onChange={(e) => set("intake.waiver", e.target.value)} placeholder={t("intake.defaultWaiver")} />
                <small>{t("settings.intakeWaiverHint")}</small></label>
              <label className="check full"><input type="checkbox" checked={settings["vault.techAccess"] !== "0"} onChange={(e) => set("vault.techAccess", e.target.checked ? "1" : "0")} />{t("settings.vaultTechAccess")}</label>
              <p className="hint full">{t("settings.vaultHint")}</p>
              <label className="field"><span>{t("settings.unclaimedDays")}</span><input type="number" min="1" max="3650" value={settings["unclaimed.days"]} placeholder="30" onChange={(e) => set("unclaimed.days", e.target.value)} /><small>{t("settings.unclaimedDaysHint")}</small></label>
              <label className="field"><span>{t("settings.wipePrefix")}</span><input value={settings["wipe.prefix"]} placeholder="WIPE-" onChange={(e) => set("wipe.prefix", e.target.value)} /></label>
              <label className="field full"><span>{t("settings.wipeStatement")}</span>
                <textarea rows={4} value={settings["wipe.statement"]} onChange={(e) => set("wipe.statement", e.target.value)} placeholder={t("wipe.defaultStatement")} /></label>
            </div>
          </Section>}
          {isServerMode && <Section id="notifications" icon="bell" title={t("settings.notifications")} hint={t("settings.notificationsHint")}
            footer={<button type="button" className="btn btn-primary" disabled={!changed(notifyKeys) || busy !== ""} onClick={() => void persist(notifyKeys)}>{t("common.saveChanges")}</button>}>
            <NotificationSettings settings={settings} set={set} />
          </Section>}
          {isServerMode && <Section id="checklists" icon="check" title={t("checklist.templates")} hint={t("checklist.templatesHint")}><ChecklistTemplateSettings /></Section>}
          {isServerMode && <Section id="storage" icon="hardDrive" title={t("storage.title")} hint={t("storage.hint")}><StorageSettings /></Section>}
          {isServerMode && <Section id="activity" icon="activity" title={t("activity.title")} hint={t("activity.hint")}><AuditLogSettings /></Section>}
          </>}

          <Section id="language" icon="globe" title={t("settings.language")} hint={t("settings.languageHint")}>
            <div style={{ maxWidth: 320 }}><LanguageDropdown locale={locale} setLocale={setLocale} locales={locales} label={t("settings.language")} searchLabel={t("settings.searchLanguage")} /></div>
          </Section>

          {isAdmin && <Section id="data" icon="database" title={t("settings.data")} hint={t("settings.dataHint")}>
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <h3>{t("settings.backup")}</h3><p className="hint">{t("settings.backupHint")}</p>
                <div className="page-actions">
                  <button type="button" className="btn" disabled={busy !== ""} onClick={() => void run("backup", nativeBackup)}>{busy === "backup" ? t("settings.backupRunning") : t("settings.createBackup")}</button>
                  <label className="btn file-button">{busy === "restore" ? t("settings.restoreRunning") : t("settings.restoreBackup")}<input type="file" accept={isServerMode ? ".dump,application/octet-stream" : ".db,application/x-sqlite3,application/vnd.sqlite3"} disabled={busy !== ""} onChange={(e) => void restoreNative(e)} /></label>
                </div>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <h3>{t("settings.portableTitle")}</h3><p className="hint">{t("settings.portableHint")}</p>
                <div className="page-actions">
                  <button type="button" className="btn" disabled={busy !== ""} onClick={() => void run("portable", exportPortableBackup)}>{busy === "portable" ? t("settings.portableExporting") : t("settings.portableCreate")}</button>
                  <label className="btn file-button">{busy === "portable-restore" ? t("settings.portableRestoring") : t("settings.portableRestore")}<input type="file" accept=".dbrepairs,application/json" disabled={busy !== ""} onChange={(e) => void restorePortable(e)} /></label>
                </div>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <h3>{t("settings.export")}</h3><p className="hint">{t("settings.exportHint")}</p>
                <div className="page-actions">
                  <button type="button" className="btn" disabled={busy !== ""} onClick={() => void exportCsv("customers")}>{t("settings.exportCustomers")}</button>
                  <button type="button" className="btn" disabled={busy !== ""} onClick={() => void exportCsv("repairs")}>{t("settings.exportRepairs")}</button>
                </div>
              </div>
            </div>
          </Section>}
          </OpenSection.Provider>
        </div>
      </div>
    </div>
  );
}

function NotificationSettings({ settings, set }: { settings: AppSettings; set: (key: SettingKey, value: string) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MessagingStatus | null>(null);
  useEffect(() => { messagingStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  const channel = (on: boolean | undefined, label: string) => (
    <span className={`badge ${on ? "success" : ""}`}><Icon name={on ? "check" : "x"} size={12} />{label}: {t(on ? "settings.channelOn" : "settings.channelOff")}</span>
  );
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <h3>{t("settings.channels")}</h3>
        <div className="page-actions">{channel(status?.email, t("settings.channelEmail"))}{channel(status?.sms, t("settings.channelSms"))}{channel(status?.push, t("settings.channelPush"))}</div>
        <p className="hint">{t("settings.channelsHint")}</p>
      </div>
      {(["received", "ready"] as const).map((event) => {
        const key = (suffix: string) => `notify.${event}${suffix}` as SettingKey;
        return (
          <div key={event} style={{ display: "grid", gap: 10 }}>
            <label className="check"><input type="checkbox" checked={settings[key("")] === "1"} onChange={(e) => set(key(""), e.target.checked ? "1" : "0")} /><strong>{t(`settings.notify.${event}`)}</strong></label>
            {settings[key("")] === "1" && <div className="form-grid">
              <label className="field full"><span>{t("settings.emailSubject")}</span><input value={settings[key("Subject")]} placeholder={defaultTemplates[event].subject} onChange={(e) => set(key("Subject"), e.target.value)} /></label>
              <label className="field full"><span>{t("settings.emailBody")}</span><textarea rows={6} value={settings[key("Body")]} placeholder={defaultTemplates[event].body} onChange={(e) => set(key("Body"), e.target.value)} /></label>
              <label className="field full"><span>{t("settings.smsText")}</span><textarea rows={2} value={settings[key("Sms")]} placeholder={defaultTemplates[event].sms} onChange={(e) => set(key("Sms"), e.target.value)} /></label>
            </div>}
          </div>
        );
      })}
      <p className="hint">{t("settings.templateHint")}</p>
      <div style={{ display: "grid", gap: 10 }}>
        <h3>{t("settings.statusPage")}</h3>
        <label className="check"><input type="checkbox" checked={settings["status.enabled"] === "1"} onChange={(e) => set("status.enabled", e.target.checked ? "1" : "0")} />{t("settings.statusEnabled")}</label>
        <div className="form-grid">
          <label className="field"><span>{t("settings.statusUrl")}</span><input value={settings["status.publicUrl"]} placeholder="https://shop.tail1234.ts.net:8443" onChange={(e) => set("status.publicUrl", e.target.value.trim())} /><small>{t("settings.statusUrlHint")}</small></label>
          <label className="field"><span>{t("settings.statusLanguage")}</span>
            <select value={settings["status.language"] || "en"} onChange={(e) => set("status.language", e.target.value)}>
              <option value="en">English</option><option value="pt-PT">Português</option><option value="es">Español</option><option value="fr">Français</option>
            </select></label>
        </div>
        <p className="hint">{t("settings.statusHint")}</p>
      </div>
    </div>
  );
}

function ThemeInput({ field, value, label, customLabel, onChange }: { field: ThemeField; value: string; label: string; customLabel: string; onChange: (value: string) => void }) {
  if (field.kind === "color") {
    const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    return (
      <div className="color-field">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <label>{label}<input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} /></label>
      </div>
    );
  }
  if (field.kind === "radius") {
    return <label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{radiusOptions.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>;
  }
  const known = fontOptions.some((option) => option.value === value);
  const [custom, setCustom] = useState(!known);
  return (
    <label className="field"><span>{label}</span>
      <select value={known && !custom ? value : "custom"} onChange={(e) => { const next = e.target.value; setCustom(next === "custom"); if (next !== "custom") onChange(next); }}>
        {fontOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        <option value="custom">{customLabel}</option>
      </select>
      {(custom || !known) && <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />}
      <small style={{ fontFamily: value }}>The quick brown fox · 0123456789</small>
    </label>
  );
}
