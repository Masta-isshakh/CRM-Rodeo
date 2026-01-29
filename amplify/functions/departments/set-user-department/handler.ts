import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminAddUserToGroupCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../../data/resource";

type Handler = Schema["adminSetUserDepartment"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

const RESERVED = new Set(["ADMIN"]); // keep ADMIN if user has it

export const handler: Handler = async (event) => {
  const email = event.arguments.email.trim().toLowerCase();
  const departmentName = event.arguments.departmentName.trim();
  if (!email || !departmentName) throw new Error("email and departmentName are required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  // ensure group exists
  try {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: departmentName }));
  } catch {
    // ignore AlreadyExists
  }

  // remove from non-reserved groups
  const groupsRes = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: email })
  );

  const current = (groupsRes.Groups ?? []).map(g => g.GroupName).filter(Boolean) as string[];
  for (const g of current) {
    if (!RESERVED.has(g) && g !== departmentName) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: g }));
    }
  }

  // add to new department
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: departmentName }));

  // update UserProfile.departmentName
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const existing = await dataClient.models.UserProfile.list({ filter: { email: { eq: email } }, limit: 1 });
  if (existing.data.length) {
    await dataClient.models.UserProfile.update({ id: existing.data[0].id, departmentName });
  }

  return { ok: true, email, departmentName };
};
