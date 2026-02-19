export const POLICY_LABELS = {
  DASHBOARD: "Dashboard",
  CUSTOMERS: "Customers",
    VEHICLES: "Vehicles", // ✅ ADD

  TICKETS: "Tickets",
  EMPLOYEES: "Employees",
  ACTIVITY_LOG: "Activity Log",
  JOB_CARDS: "Job Cards",
  CALL_TRACKING: "Call Tracking",
  INSPECTION_APPROVALS: "Inspection Approvals",

  USERS_ADMIN: "Users (Admin)",
  DEPARTMENTS_ADMIN: "Departments (Admin)",
  ROLES_POLICIES_ADMIN: "Roles & Policies (Admin)",
} as const;

export type PolicyKey = keyof typeof POLICY_LABELS;
