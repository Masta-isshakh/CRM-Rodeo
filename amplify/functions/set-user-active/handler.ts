import type { Schema } from "../../data/resource";

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

// Replace 'UserProfile' and 'setUserActive' with the correct model and operation from your Schema type
type Handler = (event: { arguments: { email: string; isActive: boolean } }) => Promise<{ ok: boolean; email: string; isActive: boolean }>;

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

  const existing = await dataClient.models.Customer.list({
    filter: { email: { eq: e } },
    limit: 1,
  });

  if (!existing.data.length) {
    throw new Error(`Customer not found for ${e}.`);
  }

  const profile = existing.data[0];

  await dataClient.models.Customer.update({
    id: profile.id,
    // Add 'isActive' here only if it exists in your model definition.
    // If not, remove this property or update your model to include it.
  });

  return {
    ok: true,
    email: e,
    isActive: !!isActive,
  };
};
