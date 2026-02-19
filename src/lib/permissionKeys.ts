// src/lib/permissionKeys.ts
export const RESOURCE_KEYS = [
  "DASHBOARD",
  "CUSTOMERS",
    "VEHICLES", // ✅ ADD

  "TICKETS",
  "EMPLOYEES",
  "ACTIVITY_LOG",
  "JOB_CARDS",
  "CALL_TRACKING",
  "INSPECTION_APPROVALS",
  "USERS_ADMIN",
  "DEPARTMENTS_ADMIN",
  "ROLES_POLICIES_ADMIN",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];
