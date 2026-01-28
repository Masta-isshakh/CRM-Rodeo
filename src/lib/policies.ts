export type PolicyKey =
  | "DASHBOARD"
  | "CUSTOMERS"
  | "TICKETS"
  | "EMPLOYEES"
  | "ACTIVITY_LOG"
  | "USERS_ADMIN"
  | "JOB_CARDS"
  | "CALL_TRACKING"
  | "INSPECTION_APPROVALS"
  | "DEPARTMENTS_ADMIN"
  | "ROLES_POLICIES_ADMIN";

export const POLICY_LABELS: Record<PolicyKey, string> = {
  DASHBOARD: "Dashboard",
  CUSTOMERS: "Customers",
  TICKETS: "Tickets",
  EMPLOYEES: "Employees",
  ACTIVITY_LOG: "Activity Log",
  USERS_ADMIN: "Users",
  JOB_CARDS: "Job Cards",
  CALL_TRACKING: "Call Tracking",
  INSPECTION_APPROVALS: "Inspection Approvals",
  DEPARTMENTS_ADMIN: "Departments (Admin)",
  ROLES_POLICIES_ADMIN: "Roles & Policies (Admin)",
};

export type PolicyActions = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

export const EMPTY_ACTIONS: PolicyActions = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};
