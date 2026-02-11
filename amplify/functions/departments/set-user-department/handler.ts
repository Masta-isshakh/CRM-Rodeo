// amplify/functions/departments/set-user-departments/handler.ts
import type { Schema } from "../../../data/resource";
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GetGroupCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { isDeptGroup, keyToLabel } from "../_shared/departmentKey";

const cognito = new CognitoIdentityProviderClient();

async function ensureGroup(userPoolId: string, groupName: string, description?: string) {
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: groupName }));
    return;
  } catch {
    await cognito.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: groupName,
        Description: description || keyToLabel(groupName),
      })
    );
  }
}

// ✅ Resolve Cognito Username reliably (works for both "email as username" AND random usernames)
async function resolveCognitoUsername(userPoolId: string, email: string): Promise<string> {
  // 1) If email is the Username, this succeeds
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    return email;
  } catch {
    // 2) Otherwise, find by email attribute
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      })
    );

    const username = res.Users?.[0]?.Username;
    if (!username) throw new Error(`Cognito user not found for email: ${email}`);
    return username;
  }
}

export const handler = async (event: {
  arguments: { email: string; departmentKey: string; departmentName?: string };
}) => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const email = event.arguments.email.trim().toLowerCase();
  const departmentKey = event.arguments.departmentKey.trim();
  const departmentName = (event.arguments.departmentName || "").trim();

  if (!email) throw new Error("Email is required");
  if (!departmentKey) throw new Error("departmentKey is required");

  await ensureGroup(userPoolId, departmentKey, departmentName);

  // ✅ Use correct Cognito Username
  const username = await resolveCognitoUsername(userPoolId, email);

  // Remove current DEPT_* groups (except the target one)
  const groupsRes = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
  );

  const current = (groupsRes.Groups ?? []).map((g) => g.GroupName).filter(Boolean) as string[];

  for (const g of current) {
    if (isDeptGroup(g) && g !== departmentKey) {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: g,
        })
      );
    }
  }

  // Add to new department group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: departmentKey,
    })
  );

  // Update UserProfile
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 1,
  });

  if (!existing.data.length) throw new Error(`UserProfile not found for ${email}`);

  const profile = existing.data[0];

  await dataClient.models.UserProfile.update({
    id: profile.id,
    departmentKey,
    departmentName: departmentName || keyToLabel(departmentKey),
  });

  return {
    ok: true,
    email,
    departmentKey,
    departmentName: departmentName || keyToLabel(departmentKey),
  };
};
