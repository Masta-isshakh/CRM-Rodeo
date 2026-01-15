import type { Schema } from "../../data/resource";

import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = Schema["adminUpdateUserRole"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

const ROLE_GROUPS = ["ADMIN", "SALES", "SALES_MANAGER", "SUPPORT"] as const;
type Role = (typeof ROLE_GROUPS)[number];

const ROLE_SET = new Set<string>(ROLE_GROUPS);

export const handler: Handler = async (event) => {
  const { email, role } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");
  if (!role || !ROLE_SET.has(role)) {
    throw new Error("Invalid role. Allowed roles: ADMIN, SALES, SALES_MANAGER, SUPPORT");
  }
  const newRole = role as Role;

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  // 1) Remove from any existing role group(s)
  const groupsRes = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: e,
    })
  );

  const currentGroups = (groupsRes.Groups ?? []).map((g) => g.GroupName).filter(Boolean) as string[];

  for (const g of currentGroups) {
    if (ROLE_SET.has(g) && g !== newRole) {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: userPoolId,
          Username: e,
          GroupName: g,
        })
      );
    }
  }

  // 2) Add to the new role group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: e,
      GroupName: newRole,
    })
  );

  // 3) Update UserProfile role in Data
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: e } },
    limit: 1,
  });

  if (!existing.data.length) {
    throw new Error(`UserProfile not found for ${e}.`);
  }

  const profile = existing.data[0];

  await dataClient.models.UserProfile.update({
    id: profile.id,
    role: newRole,
  });

  return {
    ok: true,
    email: e,
    role: newRole,
  };
};
