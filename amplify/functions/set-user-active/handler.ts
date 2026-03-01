import type { Schema } from "../../data/resource";

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: { arguments: { email: string; isActive: boolean } }) => Promise<{ ok: boolean; email: string; isActive: boolean }>;

const cognito = new CognitoIdentityProviderClient();

async function resolveCognitoUsername(userPoolId: string, email: string): Promise<string> {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    return email;
  } catch {
    const listed = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      })
    );

    const username = String(listed.Users?.[0]?.Username ?? "").trim();
    if (!username) throw new Error(`Cognito user not found for email: ${email}`);
    return username;
  }
}

export const handler: Handler = async (event) => {
  const { email, isActive } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  const username = await resolveCognitoUsername(userPoolId, e);

  // 1) Disable/Enable in Cognito
  if (isActive) {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
  } else {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
  }

  // 2) Update UserProfile in Data
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
    email: profile.email,
    fullName: profile.fullName,
    profileOwner: profile.profileOwner,
    createdAt: profile.createdAt ?? new Date().toISOString(),
    isActive: !!isActive,
    departmentKey: profile.departmentKey ?? undefined,
    departmentName: profile.departmentName ?? undefined,
    mobileNumber: profile.mobileNumber ?? undefined,
  });

  return {
    ok: true,
    email: e,
    isActive: !!isActive,
  };
};
