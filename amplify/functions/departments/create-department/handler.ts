import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GetGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { toDeptKey } from "../_shared/departmentKey";

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event: { arguments: { departmentName: string } }) => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const label = event.arguments.departmentName.trim();
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
