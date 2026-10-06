import { useEffect, useState } from "react";
import CustomersPage from "./pages/CustomersPage";
import LanguageDropdown from "./components/LanguageDropdown";
import SettingsPage from "./pages/SettingsPage";
import RepairsPage from "./pages/RepairsPage";
import {
  DashboardRecentRepair,
  DashboardStats,
  getDashboardStats,
  listDashboardRecentRepairs,
} from "./data/dashboard";
import { useI18n } from "./i18n/I18nProvider";
import LoginPage from "./pages/LoginPage";
import { getSession, logout, unauthorizedEvent } from "./data/api";
import { isServerMode } from "./data/runtime";

type Page = "dashboard" | "repairs" | "customers" | "settings";
type AuthState = "checking" | "signedOut" | "signedIn";

const emptyStats: DashboardStats = {
  openRepairs: 0,
  waitingCustomer: 0,
  ready: 0,
  closedToday: 0,
};

export default function App() {
  const { t } = useI18n();
  const [auth, setAuth] = useState<AuthState>(isServerMode ? "checking" : "signedIn");

  useEffect(() => {
    if (!isServerMode) return;
    const signedOut = () => setAuth("signedOut");
    window.addEventListener(unauthorizedEvent, signedOut);
    getSession()
      .then((authenticated) => setAuth(authenticated ? "signedIn" : "signedOut"))
      .catch((error) => {
        console.error("Session check failed:", error);
        setAuth("signedOut");
      });
    return () => window.removeEventListener(unauthorizedEvent, signedOut);
  }, []);

  if (auth === "checking") return <div className="login-shell">{t("common.loading")}</div>;
  if (auth === "signedOut") return <LoginPage onSignedIn={() => setAuth("signedIn")} />;
  return <Workspace onSignOut={isServerMode ? () => void logout().finally(() => setAuth("signedOut")) : undefined} />;
}

function Workspace({ onSignOut }: { onSignOut?: () => void }) {
  const { t, locale, setLocale, locales } = useI18n();
  const [page, setPage] = useState<Page>("dashboard");
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>(emptyStats);
  const [recentRepairs, setRecentRepairs] = useState<DashboardRecentRepair[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState(false);

  useEffect(() => {
    if (page !== "dashboard") return;

    let active = true;
    setDashboardLoading(true);
    setDashboardError(false);

    Promise.all([getDashboardStats(), listDashboardRecentRepairs()])
      .then(([stats, repairs]) => {
        if (!active) return;
        setDashboardStats(stats);
        setRecentRepairs(repairs);
      })
      .catch((error) => {
        console.error("Dashboard database error:", error);
        if (active) setDashboardError(true);
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page]);

  const languageControl = (
    <LanguageDropdown
      locale={locale}
      setLocale={setLocale}
      locales={locales}
      label={t("settings.language")}
      searchLabel={t("settings.searchLanguage")}
    />
  );

  const cards = [
    ["dashboard.openRepairs", dashboardStats.openRepairs],
    ["dashboard.waitingCustomer", dashboardStats.waitingCustomer],
    ["dashboard.ready", dashboardStats.ready],
    ["dashboard.closedToday", dashboardStats.closedToday],
  ] as const;

  const deviceLabel = (repair: DashboardRecentRepair) =>
    [repair.device_type, repair.brand, repair.model].filter(Boolean).join(" · ") || "—";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img src="/dbrepairs-icon.png" alt="" /><div>DBRepairs <span>{__APP_VERSION__}</span></div></div>
        <nav>
          <button className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>{t("nav.dashboard")}</button>
          <button className={page === "repairs" ? "active" : ""} onClick={() => setPage("repairs")}>{t("nav.repairs")}</button>
          <button className={page === "customers" ? "active" : ""} onClick={() => setPage("customers")}>{t("nav.customers")}</button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>{t("nav.settings")}</button>
        </nav>
        <div className="sidebar-language">
          {languageControl}
          {onSignOut && <button type="button" className="sidebar-logout" onClick={onSignOut}>{t("auth.signOut")}</button>}
        </div>
      </aside>

      <main>
        {page === "dashboard" && (
          <>
            <header>
              <div>
                <h1>{t("dashboard.title")}</h1>
                <p>{t("dashboard.subtitle")}</p>
              </div>
            </header>

            <section className="cards">
              {cards.map(([label, value]) => (
                <article className="card" key={label}>
                  <strong>{dashboardLoading ? "…" : value}</strong>
                  <span>{t(label)}</span>
                </article>
              ))}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("repairs.title")}</h2>
                  <p>{t("repairs.emptyHint")}</p>
                </div>
                <button className="primary" onClick={() => setPage("repairs")}>+ {t("repair.new")}</button>
              </div>

              {dashboardError ? (
                <div className="empty-state">{t("database.error")}</div>
              ) : recentRepairs.length === 0 ? (
                <div className="empty-state">{dashboardLoading ? "…" : t("repairs.empty")}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("repair.number")}</th>
                        <th>{t("repair.customer")}</th>
                        <th>{t("repair.device")}</th>
                        <th>{t("repair.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRepairs.map((repair) => (
                        <tr key={repair.id}>
                          <td><strong>{repair.repair_number}</strong></td>
                          <td>{repair.customer_name}</td>
                          <td>{deviceLabel(repair)}</td>
                          <td>{t(repair.status_label_key)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {page === "customers" && <CustomersPage />}

        {page === "repairs" && <RepairsPage />}

        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
