import { FormEvent, useEffect, useState } from "react";
import Icon from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { changeMyPassword, createUser, listUsers, TeamUser, updateUser, UserInput } from "../data/users";

const blankUser: UserInput = { username: "", displayName: "", role: "tech", active: true, password: "" };

/** Admins add techs and manage their accounts. */
export function TeamSection() {
  const { t } = useI18n();
  const { user: me } = useSession();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<UserInput>(blankUser);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => listUsers().then(setUsers).catch(() => setMessage({ tone: "error", text: t("common.databaseError") }));
  useEffect(() => { void load(); }, []);
  const set = <K extends keyof UserInput>(key: K, value: UserInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function edit(user: TeamUser) {
    setForm({ username: user.username, displayName: user.displayName, role: user.role, active: user.active, password: "" });
    setEditing(user.id); setMessage(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage(null);
    try {
      if (editing === "new") await createUser(form);
      else if (typeof editing === "number") await updateUser(editing, { displayName: form.displayName, role: form.role, active: form.active, password: form.password });
      setEditing(null);
      setMessage({ tone: "success", text: t("team.saved") });
      await load();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error && cause.message ? cause.message : t("common.saveError") });
    } finally {
      setSaving(false);
    }
  }

  const builtIn = (user: TeamUser) => user.username === "admin";
  const editingUser = typeof editing === "number" ? users.find((u) => u.id === editing) : undefined;
  const lockedAccount = Boolean(editingUser && (builtIn(editingUser) || editingUser.id === me?.id));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {message && <div className={`alert ${message.tone}`}>{message.text}</div>}
      <div className="table-wrap card"><table>
        <thead><tr><th>{t("team.displayName")}</th><th>{t("auth.username")}</th><th>{t("team.role")}</th><th>{t("team.status")}</th><th></th></tr></thead>
        <tbody>{users.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.displayName}</strong>{user.id === me?.id && <span className="badge" style={{ marginLeft: 6 }}>{t("team.you")}</span>}</td>
            <td className="muted">{user.username}</td>
            <td><span className={`badge ${user.role === "admin" ? "primary" : ""}`}>{t(`team.role.${user.role}`)}</span></td>
            <td>{user.active ? <span className="badge success">{t("team.active")}</span> : <span className="badge">{t("team.disabled")}</span>}</td>
            <td className="actions"><button type="button" className="btn btn-sm" onClick={() => edit(user)}><Icon name="pencil" size={14} />{t("common.edit")}</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      {editing === null ? (
        <div><button type="button" className="btn" onClick={() => { setForm(blankUser); setEditing("new"); setMessage(null); }}><Icon name="plus" size={15} />{t("team.add")}</button></div>
      ) : (
        <form className="card card-body form-grid" onSubmit={(e) => void save(e)}>
          <h3 className="full">{editing === "new" ? t("team.add") : `${t("common.edit")}: ${form.username}`}</h3>
          {editing === "new" && <label className="field"><span>{t("auth.username")} *</span><input required autoCapitalize="none" spellCheck={false} value={form.username} onChange={(e) => set("username", e.target.value)} /><small>{t("team.usernameHint")}</small></label>}
          <label className="field"><span>{t("team.displayName")} *</span><input required value={form.displayName} onChange={(e) => set("displayName", e.target.value)} /></label>
          <label className="field"><span>{t("team.role")}</span>
            <select value={form.role} disabled={lockedAccount} onChange={(e) => set("role", e.target.value === "admin" ? "admin" : "tech")}>
              <option value="tech">{t("team.role.tech")}</option><option value="admin">{t("team.role.admin")}</option>
            </select>
            <small>{t("team.roleHint")}</small>
          </label>
          {!(editingUser && builtIn(editingUser)) && (
            <label className="field"><span>{editing === "new" ? `${t("auth.password")} *` : t("team.newPassword")}</span><input type="password" autoComplete="new-password" minLength={8} required={editing === "new"} value={form.password} onChange={(e) => set("password", e.target.value)} /><small>{editing === "new" ? t("team.passwordHint") : t("team.resetHint")}</small></label>
          )}
          {editingUser && builtIn(editingUser) && <p className="hint full">{t("team.adminHint")}</p>}
          {editing !== "new" && !lockedAccount && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />{t("team.canSignIn")}</label>}
          <div className="page-actions full" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Anyone signed in can change their own password (except the built-in admin). */
export function MyAccountSection() {
  const { t } = useI18n();
  const { user } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      await changeMyPassword(current, next);
      setCurrent(""); setNext("");
      setMessage({ tone: "success", text: t("account.passwordChanged") });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error && cause.message ? cause.message : t("common.saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p>{t("account.signedInAs")} <strong>{user.displayName}</strong> ({user.username}) · {t(`team.role.${user.role}`)}</p>
      {user.username === "admin" ? <p className="hint">{t("team.adminHint")}</p> : (
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          {message && <div className={`alert ${message.tone} full`}>{message.text}</div>}
          <label className="field"><span>{t("account.currentPassword")}</span><input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
          <label className="field"><span>{t("team.newPassword")}</span><input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} /><small>{t("team.passwordHint")}</small></label>
          <div className="full"><button type="submit" className="btn btn-primary" disabled={saving || !current || next.length < 8}>{t("account.changePassword")}</button></div>
        </form>
      )}
    </div>
  );
}
