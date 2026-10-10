import { useEffect, useState } from "react";
import {
  BarChart3,
  Dumbbell,
  Home,
  LogOut,
  Plus,
  ReceiptIndianRupee,
  Settings,
  ShieldCheck,
  Users,
  WalletCards
} from "lucide-react";
import { api, jsonBody, setCsrfToken } from "./api";
import { Button, Loading, Toast } from "./components";
import {
  AuthPage,
  BackupPage,
  DashboardPage,
  MembersPage,
  ReportsPage,
  SettingsPage,
  TransactionsPage,
  type SessionPayload,
  type View
} from "./pages";

const navItems: { view: View; label: string; icon: typeof Home }[] = [
  { view: "dashboard", label: "Dashboard", icon: Home },
  { view: "members", label: "Members", icon: Users },
  { view: "transactions", label: "Transactions", icon: ReceiptIndianRupee },
  { view: "reports", label: "Reports", icon: BarChart3 }
];

export default function App() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("dashboard");
  const [memberFilter, setMemberFilter] = useState("all");
  const [openAdd, setOpenAdd] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    async function loadSession() {
      try {
        const data = await api<SessionPayload>("/api/auth/me");
        setCsrfToken(data.csrfToken);
        setSession(data);
      } finally {
        setLoading(false);
      }
    }
    void loadSession();
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: jsonBody({}) });
    setCsrfToken(null);
    setSession({ authenticated: false, user: null, csrfToken: null });
  }

  function openMembers(status: string) {
    if (status !== "leads") setMemberFilter(status);
    setView("members");
  }

  if (loading) return <Loading label="Opening V Team Fitness Hub" />;
  if (!session?.authenticated) return <AuthPage onAuth={setSession} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Dumbbell size={28} />
          <span>V Team</span>
        </div>
        <nav>
          {[...navItems, { view: "settings" as View, label: "Settings", icon: Settings }, { view: "backup" as View, label: "Backup", icon: WalletCards }].map((item) => (
            <button key={item.view} type="button" className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}>
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">V Team Fitness Hub</p>
            <h1>{viewLabel(view)}</h1>
          </div>
          <div className="top-actions">
            {!online ? <span className="offline-pill">Offline</span> : null}
            <span className="secure-pill"><ShieldCheck size={16} /> {session.user?.username}</span>
            <button type="button" className="icon-btn" onClick={logout} aria-label="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {view === "dashboard" ? <DashboardPage onOpenMembers={openMembers} onQuickAdd={() => { setView("members"); setOpenAdd(true); }} /> : null}
        {view === "members" ? <MembersPage initialStatus={memberFilter} openAdd={openAdd} onAddHandled={() => setOpenAdd(false)} /> : null}
        {view === "transactions" ? <TransactionsPage /> : null}
        {view === "reports" ? <ReportsPage /> : null}
        {view === "settings" ? <SettingsPage /> : null}
        {view === "backup" ? <BackupPage /> : null}
      </main>

      <button className="fab" type="button" onClick={() => { setView("members"); setOpenAdd(true); }} aria-label="Quick add member">
        <Plus size={28} />
      </button>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button key={item.view} type="button" className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}>
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function viewLabel(view: View): string {
  if (view === "dashboard") return "Dashboard";
  if (view === "members") return "Members";
  if (view === "transactions") return "Transactions";
  if (view === "reports") return "Reports";
  if (view === "settings") return "Settings";
  return "Backup";
}
