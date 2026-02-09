import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

export async function logActivity(
  entityType: "Customer" | "Employee" | "Ticket" | "JobOrder",
  entityId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  message: string
) {
  await client.models.ActivityLog.create({
    entityType,
    entityId,
    action,
    message,
    createdAt: new Date().toISOString(),
  });
}
