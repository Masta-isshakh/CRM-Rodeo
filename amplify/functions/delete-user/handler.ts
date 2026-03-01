import type { Schema } from "../../data/resource";

import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: any) => Promise<any>;

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

export const handler: Handler = async (event: any) => {
  const email = String(event.arguments?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  const username = await resolveCognitoUsername(userPoolId, email);

  // 1) Delete Cognito user
  await cognito.send(
    new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    })
  );

  // 2) Delete UserProfile records (NOT Customer)
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profiles = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 50,
  });

  for (const p of profiles.data ?? []) {
    await dataClient.models.UserProfile.delete({ id: p.id });
  }

  return {
    ok: true,
    email,
    username,
    deletedProfiles: (profiles.data ?? []).length,
  };
};
