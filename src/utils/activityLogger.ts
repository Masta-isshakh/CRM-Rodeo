// src/utils/activityLogger.ts
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

// ✅ allow any entity type (your schema stores entityType as string anyway)
export type ActivityEntityType = string;

export type ActivityAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "APPROVE"
  | "REJECT"
  | string;

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
    // best-effort (never block UI)
    console.warn("[ActivityLog] failed:", e);
  }
}
