import { useEffect, useState } from "react";
import "./dashboard.css";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";

type DashboardProps = PageProps & {
  showEmployeesKpi: boolean;
  showCustomersKpi: boolean;
};

export default function Dashboard({ permissions, showEmployeesKpi, showCustomersKpi }: DashboardProps) {
  if (!permissions.canRead) return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;

  const client = getDataClient();

  const EmployeeModel = (client.models as any).Employee as any;
  const CustomerModel = (client.models as any).Customer as any;

  const [employeeCount, setEmployeeCount] = useState<number>(0);
  const [customerCount, setCustomerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      if (showEmployeesKpi && EmployeeModel) {
        const res = await EmployeeModel.list({ limit: 2000 });
        setEmployeeCount((res.data ?? []).length);
      } else setEmployeeCount(0);

      if (showCustomersKpi && CustomerModel) {
        const res = await CustomerModel.list({ limit: 2000 });
        setCustomerCount((res.data ?? []).length);
      } else setCustomerCount(0);
    } catch (error) {
      console.error("Dashboard stats error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-page">
      <h2>Dashboard</h2>
      <p className="subtitle">Overview of your company activity</p>

      {loading ? (
        <p>Loading statistics...</p>
      ) : (
        <div className="kpi-grid">
          {showEmployeesKpi && (
            <div className="kpi-card">
              <div className="kpi-circle blue">{employeeCount}</div>
              <div className="kpi-label">Employees</div>
            </div>
          )}

          {showCustomersKpi && (
            <div className="kpi-card">
              <div className="kpi-circle green">{customerCount}</div>
              <div className="kpi-label">Customers</div>
            </div>
          )}

          {!showEmployeesKpi && !showCustomersKpi && (
            <div style={{ opacity: 0.8 }}>No KPIs available for your current role policies.</div>
          )}
        </div>
      )}
    </div>
  );
}
