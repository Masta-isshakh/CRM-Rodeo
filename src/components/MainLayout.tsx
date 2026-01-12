import { useEffect, useState } from "react";
import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";
import AdminUsers from "../pages/UserAdmin";

import {
  fetchAuthSession,
  getCurrentUser,
  GetCurrentUserOutput,
} from "aws-amplify/auth";

import logo from "../assets/logo.jpeg";
import "./mainLayout.css";

interface Props {
  user: GetCurrentUserOutput | null;
  signOut: () => void;
}

type Page =
  | "dashboard"
  | "employees"
  | "customers"
  | "tickets"
  | "activitylogger"
  | "users";

export default function MainLayout({ signOut }: Props) {
  const [page, setPage] = useState<Page>("dashboard");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Mobile drawer state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const u = await getCurrentUser();
        setUserEmail(u.signInDetails?.loginId || null);

        const session = await fetchAuthSession();
        const groups =
          (session.tokens?.idToken?.payload["cognito:groups"] as string[]) ?? [];
        setIsAdmin(groups.includes("ADMIN"));
      } catch (err) {
        console.error(err);
        setUserEmail(null);
        setIsAdmin(false);
      }
    };
    load();
  }, []);

  // Close sidebar on page change (mobile)
  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  return (
    <div className="layout-container">
      {/* Mobile overlay */}
      <div
        className={`overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar (desktop + drawer on mobile) */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <img src={logo} alt="Rodeo Drive CRM Logo" className="logo-img" />
          <span className="logo-text">Rodeo Drive CRM</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={page === "dashboard" ? "active" : ""}
            onClick={() => go("dashboard")}
          >
            Dashboard
          </button>

          <button
            className={page === "employees" ? "active" : ""}
            onClick={() => go("employees")}
          >
            Employees
          </button>

          <button
            className={page === "customers" ? "active" : ""}
            onClick={() => go("customers")}
          >
            Customers
          </button>

          <button
            className={page === "tickets" ? "active" : ""}
            onClick={() => go("tickets")}
          >
            Tickets
          </button>

          <button
            className={page === "activitylogger" ? "active" : ""}
            onClick={() => go("activitylogger")}
          >
            Activity Logger
          </button>

          {isAdmin && (
            <button
              className={page === "users" ? "active" : ""}
              onClick={() => go("users")}
            >
              Users
            </button>
          )}

          <button className="danger" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="main-header">
          <button
            className="menu-btn"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <div className="header-text">
            <h1>Welcome</h1>
            <p className="sub">
              {userEmail ? `Signed in as: ${userEmail}` : "Loading user..."}
            </p>
          </div>
        </header>

        <section className="page-content">
          {page === "dashboard" && <Dashboard />}
          {page === "employees" && <Employees />}
          {page === "customers" && <Customers />}
          {page === "tickets" && <Tickets />}
          {page === "activitylogger" && <ActivityLog />}
          {page === "users" && isAdmin && <AdminUsers />}
        </section>
      </main>
    </div>
  );
}
