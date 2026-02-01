import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event: any) => {
  // Prefer explicit USER_POOL_ID if you set it; fallback to Gen2-provided env var
  const userPoolId =
    process.env.USER_POOL_ID || process.env.AMPLIFY_AUTH_USERPOOL_ID;

  if (!userPoolId) {
    throw new Error("Missing USER_POOL_ID / AMPLIFY_AUTH_USERPOOL_ID");
  }

  // AppSync/Lambda identity shape varies; support common fields
  const username =
    event?.identity?.username ||
    event?.identity?.claims?.["cognito:username"] ||
    event?.identity?.claims?.email ||
    "";

  if (!username) {
    throw new Error("Could not resolve username from event.identity");
  }

  const res = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    })
  );

  const groups = (res.Groups ?? [])
    .map((g) => g.GroupName)
    .filter(Boolean);

  return { groups };
};
