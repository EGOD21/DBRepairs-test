import { useEffect, useState } from "react";
import LanguageDropdown from "./components/LanguageDropdown";
import Icon, { IconName } from "./components/Icon";
import { useI18n } from "./i18n/I18nProvider";
import { useBranding } from "./branding";
import { getSession, logout, SessionUser, unauthorizedEvent } from "./data/api";
import { isServerMode } from "./data/runtime";
import { listParts } from "./data/parts";
import { href, Route, useRoute } from "./router";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RepairsPage from "./pages/RepairsPage";
import RepairDetailPage from "./pages/RepairDetailPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerProfilePage from "./pages/CustomerProfilePage";
import PartsPage from "./pages/PartsPage";
import SettingsPage from "./pages/SettingsPage";
import ChatPage from "./pages/ChatPage";
import BillingPage from "./pages/BillingPage";
import InvoicePage from "./pages/InvoicePage";
import RunningTimerChip from "./components/RunningTimerChip";
import { SessionProvider, useSession } from "./session";
import { getLastSeen, unreadCount } from "./data/chat";

type AuthState = "checking" | "signedOut" | "signedIn";

export default function App() {
  const { t } = useI18n();
  const [auth, setAuth] = useState<AuthState>(isServerMode ? "checking" : "signedIn");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    if (!isServerMode) return;
    const signedOut = () => setAuth("signedOut");
    window.addEventListener(unauthorizedEvent, signedOut);
    getSession()
      .then((current) => { setUser(current); setAuth(current ? "signedIn" : "signedOut"); })
      .catch((error) => {
        console.error("Session check failed:", error);
        setAuth("signedOut");
      });
    return () => window.removeEventListener(unauthorizedEvent, signedOut);
  }, []);

  if (auth === "checking") return <div className="login-shell muted">{t("common.loading")}</div>;
  if (auth === "signedOut") return <LoginPage onSignedIn={(current) => { setUser(current); setAuth("signedIn"); }} />;
  return (
    <SessionProvider user={user}>
      <Workspace onSignOut={isServerMode ? () => void logout().finally(() => { setUser(null); setAuth("signedOut"); }) : undefined} />
    </SessionProvider>
  );
}

const collapsedKey = "dbrepairs.sidebarCollapsed";

function readCollapsed() {
  try { return localStorage.getItem(collapsedKey) === "true"; } catch { return false; }
}

function Workspace({ onSignOut }: { onSignOut?: () => void }) {
  const { t, locale, setLocale, locales } = useI18n();
  const { companyName, logo } = useBranding();
  const route = useRoute();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { user, teamFeatures } = useSession();
  const [partsToOrder, setPartsToOrder] = useState(0);
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    listParts("needed").then((parts) => setPartsToOrder(parts.length)).catch(() => setPartsToOrder(0));
  }, [route]);

  // New team messages since this browser last opened the chat.
  useEffect(() => {
    if (!teamFeatures) return;
    if (route.name === "chat") { setUnread(0); return; }
    const check = () => unreadCount(getLastSeen()).then((r) => setUnread(r.count)).catch(() => {});
    void check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [route, teamFeatures]);

  function toggle() {
    setCollapsed((value) => {
      try { localStorage.setItem(collapsedKey, String(!value)); } catch { /* not remembered, still works */ }
      return !value;
    });
  }

  useEffect(() => { setMoreOpen(false); }, [route]);

  const sections: Partial<Record<Route["name"], Route["name"]>> = { repair: "repairs", customer: "customers", invoice: "billing" };
  const section = sections[route.name] ?? route.name;
  // "phone" links sit in the bottom bar on phones; the rest are under More.
  type NavLink = { route: Route; icon: IconName; label: string; badge?: number; phone?: boolean };
  const links: NavLink[] = [
    { route: { name: "dashboard" }, icon: "dashboard", label: t("nav.dashboard"), phone: true },
    { route: { name: "repairs" }, icon: "wrench", label: t("nav.repairs"), phone: true },
    { route: { name: "customers" }, icon: "users", label: t("nav.customers"), phone: true },
    ...(teamFeatures ? [{ route: { name: "billing" } as Route, icon: "receipt" as IconName, label: t("nav.billing"), phone: true }] : []),
    { route: { name: "parts" }, icon: "package", label: t("nav.parts"), badge: partsToOrder || undefined },
    ...(teamFeatures ? [{ route: { name: "chat" } as Route, icon: "message" as IconName, label: t("nav.chat"), badge: unread || undefined }] : []),
    { route: { name: "settings" }, icon: "settings", label: t("nav.settings") },
  ];
  const phoneLinks = links.filter((link) => link.phone);
  const moreLinks = links.filter((link) => !link.phone);
  const moreBadge = moreLinks.reduce((sum, link) => sum + (link.badge ?? 0), 0);
  const moreActive = moreLinks.some((link) => link.route.name === section);

  return (
    <div className={`app-shell${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand" title={companyName}>
          <img src={logo} alt="" />
          <div className="sidebar-brand-text"><strong>{companyName}</strong><span>DBRepairs {__APP_VERSION__}</span></div>
        </div>
        <nav className="sidebar-nav" aria-label={t("nav.main")}>
          {links.map((link) => (
            <a key={link.route.name} href={href(link.route)} className={`sidebar-link${section === link.route.name ? " active" : ""}`} title={collapsed ? link.label : undefined}>
              <Icon name={link.icon} /><span className="sidebar-label">{link.label}</span>{link.badge ? <span className="badge">{link.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          {teamFeatures && <RunningTimerChip refreshKey={route} />}
          <div className="sidebar-language">
            <LanguageDropdown locale={locale} setLocale={setLocale} locales={locales} label={t("settings.language")} searchLabel={t("settings.searchLanguage")} />
          </div>
          {onSignOut && (
            <button type="button" className="sidebar-link" onClick={onSignOut} title={`${t("auth.signOut")}${user ? ` (${user.displayName})` : ""}`}>
              <Icon name="logout" /><span className="sidebar-label truncate">{t("auth.signOut")}{user ? ` · ${user.displayName}` : ""}</span>
            </button>
          )}
          <button type="button" className="sidebar-link sidebar-collapse" onClick={toggle} aria-pressed={collapsed} title={collapsed ? t("nav.expand") : t("nav.collapse")}>
            <Icon name="panel" /><span className="sidebar-label">{t("nav.collapse")}</span>
          </button>
        </div>
      </aside>
      {/* Phones: compact top bar with the logo, and tabs at the bottom (see styles.css). */}
      <header className="mobile-topbar">
        <a className="mobile-brand" href={href({ name: "dashboard" })}><img src={logo} alt="" /><strong className="truncate">{companyName}</strong></a>
        <div className="mobile-topbar-actions">
          {teamFeatures && <RunningTimerChip refreshKey={route} />}
          {onSignOut && <button type="button" className="btn btn-ghost btn-icon" onClick={onSignOut} aria-label={t("auth.signOut")}><Icon name="logout" /></button>}
        </div>
      </header>
      <main className="main">
        {route.name === "dashboard" && <DashboardPage />}
        {route.name === "repairs" && <RepairsPage filter={route.filter} />}
        {route.name === "repair" && <RepairDetailPage key={route.id} id={route.id} />}
        {route.name === "customers" && <CustomersPage filter={route.filter} />}
        {route.name === "customer" && <CustomerProfilePage key={route.id} id={route.id} />}
        {route.name === "parts" && <PartsPage />}
        {route.name === "chat" && (teamFeatures ? <ChatPage /> : <DashboardPage />)}
        {route.name === "settings" && <SettingsPage section={route.section} />}
        {route.name === "billing" && (teamFeatures ? <BillingPage tab={route.tab} /> : <DashboardPage />)}
        {route.name === "invoice" && (teamFeatures ? <InvoicePage key={route.id} id={route.id} /> : <DashboardPage />)}
      </main>
      <nav className="bottom-nav" aria-label={t("nav.main")}>
        {phoneLinks.map((link) => (
          <a key={link.route.name} href={href(link.route)} className={section === link.route.name ? "active" : ""} aria-current={section === link.route.name ? "page" : undefined}>
            <span className="bottom-nav-icon"><Icon name={link.icon} size={22} />{link.badge ? <span className="bottom-nav-badge">{link.badge > 99 ? "99+" : link.badge}</span> : null}</span>
            <span className="bottom-nav-label">{link.label}</span>
          </a>
        ))}
        <button type="button" className={moreActive || moreOpen ? "active" : ""} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
          <span className="bottom-nav-icon"><Icon name="menu" size={22} />{moreBadge ? <span className="bottom-nav-badge">{moreBadge > 99 ? "99+" : moreBadge}</span> : null}</span>
          <span className="bottom-nav-label">{t("nav.more")}</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="more-sheet-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
          <nav className="more-sheet" aria-label={t("nav.more")} onClick={(event) => event.stopPropagation()}>
            {moreLinks.map((link) => (
              <a key={link.route.name} href={href(link.route)} className={section === link.route.name ? "active" : ""}>
                <Icon name={link.icon} size={20} /><span>{link.label}</span>{link.badge ? <span className="badge">{link.badge}</span> : null}
              </a>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
