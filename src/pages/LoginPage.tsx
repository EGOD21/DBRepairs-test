import { FormEvent, useState } from "react";
import LanguageDropdown from "../components/LanguageDropdown";
import { login } from "../data/api";
import { useI18n } from "../i18n/I18nProvider";

export default function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, locale, setLocale, locales } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await login(password);
      if (result === "ok") {
        setPassword("");
        onSignedIn();
        return;
      }
      setError(t(result === "throttled" ? "auth.throttled" : "auth.invalid"));
    } catch (cause) {
      console.error(cause);
      setError(t("database.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="panel login-panel" onSubmit={(event) => void submit(event)}>
        <div className="login-brand"><img src="/dbrepairs-icon.png" alt="" /><strong>DBRepairs</strong></div>
        <h1>{t("auth.title")}</h1>
        <p>{t("auth.subtitle")}</p>
        {error && <div className="alert error login-alert" role="alert">{error}</div>}
        <label className="field">
          <span>{t("auth.password")}</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy || !password}>{busy ? t("auth.signingIn") : t("auth.signIn")}</button>
        <div className="login-language">
          <LanguageDropdown locale={locale} setLocale={setLocale} locales={locales} label={t("settings.language")} searchLabel={t("settings.searchLanguage")} />
        </div>
      </form>
    </div>
  );
}
