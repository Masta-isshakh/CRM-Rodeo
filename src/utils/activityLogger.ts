// src/utils/activityLogger.ts
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

// ✅ Include Vehicle + still allow future entity types without breaking builds
export type ActivityEntityType =
  | "Customer"
  | "Vehicle"
  | "Employee"
  | "Ticket"
  | "JobOrder"
  | "CallTracking"
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
  try {
    await client.models.ActivityLog.create({
      entityType,
      entityId,
      action,
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[ActivityLog] failed:", e);
  }
}
