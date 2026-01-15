import type { Schema } from "../../data/resource";

import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = Schema["adminDeleteUser"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event) => {
  const { email } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  // 1) Delete from Cognito
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: e }));

  // 2) Delete UserProfile from Data
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profiles = await dataClient.models.UserProfile.list({
    filter: { email: { eq: e } },
    limit: 10,
  });

  for (const p of profiles.data) {
    await dataClient.models.UserProfile.delete({ id: p.id });
  }

  return {
    ok: true,
    email: e,
    deletedProfiles: profiles.data.length,
  };
};
