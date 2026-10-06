import { FormEvent, useState } from "react";
import LanguageDropdown from "../components/LanguageDropdown";
import { login, SessionUser } from "../data/api";
import { useI18n } from "../i18n/I18nProvider";
import { useBranding } from "../branding";

export default function LoginPage({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const { t, locale, setLocale, locales } = useI18n();
  const { companyName, logo } = useBranding();
  const [username, setUsername] = useState(() => { try { return localStorage.getItem("dbrepairs.lastUsername") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await login(username.trim(), password);
      if (result.status === "ok") {
        try { localStorage.setItem("dbrepairs.lastUsername", username.trim()); } catch { /* not remembered */ }
        setPassword("");
        onSignedIn(result.user);
        return;
      }
      setError(t(result.status === "throttled" ? "auth.throttled" : "auth.invalid"));
    } catch (cause) {
      console.error(cause);
      setError(t("database.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="login-brand"><img src={logo} alt="" /><h1>{companyName}</h1></div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <label className="field">
          <span>{t("auth.username")}</span>
          <input autoFocus={!username} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("auth.password")}</span>
          <input type="password" autoFocus={Boolean(username)} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !password || !username.trim()}>{busy ? t("auth.signingIn") : t("auth.signIn")}</button>
        <LanguageDropdown locale={locale} setLocale={setLocale} locales={locales} label={t("settings.language")} searchLabel={t("settings.searchLanguage")} />
      </form>
    </div>
  );
}
