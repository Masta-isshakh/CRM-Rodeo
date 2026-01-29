import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GetGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Schema } from "../../../data/resource";

type Handler = Schema["adminCreateDepartment"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event) => {
  const { departmentName } = event.arguments;
  const name = departmentName.trim();
  if (!name) throw new Error("departmentName required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  // if already exists, just return OK
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: name }));
    return { ok: true, created: false, name };
  } catch {
    // create
  }

  await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: name }));
  return { ok: true, created: true, name };
};
