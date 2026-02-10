// src/utils/activityLogger.ts
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

export type ActivityEntityType =
  | "Customer"
  | "Employee"
  | "Ticket"
  | "JobOrder"
  | "CallTracking"
  | "InspectionApproval";

export type ActivityAction = "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT" | string;

export async function logActivity(
  entityType: ActivityEntityType,
  entityId: string,
  action: ActivityAction,
  message: string
) {
  try {
    await client.models.ActivityLog.create({
      entityType,
      entityId,
      action,
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    // best-effort (never block UI)
    console.warn("[ActivityLog] failed:", e);
  }
}
