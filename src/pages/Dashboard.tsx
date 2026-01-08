import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./dashboard.css";

const client = generateClient<Schema>();

export default function Dashboard() {
  const [employeeCount, setEmployeeCount] = useState<number>(0);
  const [customerCount, setCustomerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [employeesRes, customersRes] = await Promise.all([
        client.models.Employee.list(),
        client.models.Customer.list(),
      ]);

      setEmployeeCount(employeesRes.data.length);
      setCustomerCount(customersRes.data.length);
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
          {/* Employees KPI */}
          <div className="kpi-card">
            <div className="kpi-circle blue">
              {employeeCount}
            </div>
            <div className="kpi-label">Employees</div>
          </div>

          {/* Customers KPI */}
          <div className="kpi-card">
            <div className="kpi-circle green">
              {customerCount}
            </div>
            <div className="kpi-label">Customers</div>
          </div>
        </div>
      )}
    </div>
  );
}
