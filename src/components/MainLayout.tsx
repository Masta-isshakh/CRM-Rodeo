import { useEffect, useState } from "react";
import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";
import AdminUsers from "../pages/UserAdmin";

import { fetchAuthSession, getCurrentUser, GetCurrentUserOutput } from "aws-amplify/auth";
import logo from "../assets/react.svg";
import "./mainlayout.css";

interface Props {
  user: GetCurrentUserOutput | null;
  signOut: () => void;
}

export default function MainLayout({ signOut }: Props) {
  const [page, setPage] = useState<
    "dashboard" | "employees" | "customers" | "tickets" | "activitylogger" | "users"
  >("dashboard");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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

  return (
    <div className="layout-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="Rodeo Drive CRM Logo" className="logo-img" />
          <span className="logo-text">Rodeo Drive CRM</span>
        </div>

        <nav className="sidebar-nav">
          <button onClick={() => setPage("dashboard")}>Dashboard</button>
          <button onClick={() => setPage("employees")}>Employees</button>
          <button onClick={() => setPage("customers")}>Customers</button>
          <button onClick={() => setPage("tickets")}>Tickets</button>
          <button onClick={() => setPage("activitylogger")}>Activity Logger</button>

          {isAdmin && (
            <button onClick={() => setPage("users")}>Users</button>
          )}

          <button onClick={signOut}>Sign out</button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <h1>
            Welcome. Your email address is: {userEmail || "Loading user..."}
          </h1>
        </header>

        {page === "dashboard" && <Dashboard />}
        {page === "employees" && <Employees />}
        {page === "customers" && <Customers />}
        {page === "tickets" && <Tickets />}
        {page === "activitylogger" && <ActivityLog />}
        {page === "users" && isAdmin && <AdminUsers />}
      </main>
    </div>
  );
}
