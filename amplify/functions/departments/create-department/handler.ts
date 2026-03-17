import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GetGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { toDeptKey } from "../_shared/departmentKey";
import { canPerformDepartmentAction } from "../_shared/rbac";

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event: any) => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const allowed = await canPerformDepartmentAction(event, "departments_create", "canCreate");
  if (!allowed) throw new Error("Not authorized to create departments. Check roles and policies configuration.");

  const label = (event.arguments as any).departmentName.trim();
  if (!label) throw new Error("departmentName is required");

  const key = toDeptKey(label);

  // create only if missing
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: key }));
    return { ok: true, department: { key, name: label }, message: "Already exists" };
  } catch (e: any) {
    // ignore not found
  }

  await cognito.send(
    new CreateGroupCommand({
      UserPoolId: userPoolId,
      GroupName: key,
      Description: label,
    })
  );

  return { ok: true, department: { key, name: label } };
};
