// src/utils/activityLogger.ts
import { getDataClient } from "../lib/amplifyClient";

// ✅ Include Vehicle + still allow future entity types without breaking builds
export type ActivityEntityType =
  | "Customer"
  | "Vehicle"
  | "Employee"
  | "Ticket"
  | "JobOrder"
  | "InspectionApproval"
  | (string & {});

export type ActivityAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "APPROVE"
  | "REJECT"
  | (string & {});

export async function logActivity(
  entityType: ActivityEntityType,
  entityId: string,
  action: ActivityAction,
  message: string
): Promise<void> {
  const payload = {
    entityType,
    entityId,
    action,
    message,
    createdAt: new Date().toISOString(),
  };

  try {
    const client = getDataClient();
    const first = await client.models.ActivityLog.create(payload as any);
    if (Array.isArray((first as any)?.errors) && (first as any).errors.length) {
      throw new Error((first as any).errors.map((x: any) => x?.message || String(x)).join(" | "));
    }
  } catch (firstError) {
    // Retry once for transient sync/auth state races.
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const client = getDataClient();
      const second = await client.models.ActivityLog.create(payload as any);
      if (Array.isArray((second as any)?.errors) && (second as any).errors.length) {
        throw new Error((second as any).errors.map((x: any) => x?.message || String(x)).join(" | "));
      }
    } catch (secondError) {
      console.warn("[ActivityLog] failed:", firstError, secondError);
    }
  }
}
