import type { Schema } from "../../data/resource";

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = Schema["adminSetUserActive"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event) => {
  const { email, isActive } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  // 1) Disable/Enable in Cognito
  if (isActive) {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: e }));
  } else {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: e }));
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
    isActive: !!isActive,
  });

  return {
    ok: true,
    email: e,
    isActive: !!isActive,
  };
};
