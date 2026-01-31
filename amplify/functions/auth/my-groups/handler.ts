// amplify/functions/auth/my-groups/handler.ts
import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

function getUserPoolIdFromIssuer(issuer?: string): string | null {
  // issuer example: https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXX
  if (!issuer) return null;
  const parts = String(issuer).split("/");
  const last = parts[parts.length - 1];
  return last ? String(last) : null;
}

export const handler = async (event: any) => {
  const claims = event?.identity?.claims ?? {};

  const issuer =
    claims?.iss ||
    claims?.issuer ||
    event?.identity?.issuer ||
    event?.requestContext?.authorizer?.claims?.iss;

  const userPoolId = getUserPoolIdFromIssuer(issuer);

  // prefer Cognito username
  const username =
    claims["cognito:username"] ||
    claims["username"] ||
    event?.identity?.username ||
    claims["sub"];

  if (!userPoolId || !username) {
    return {
      username: username ?? null,
      groups: [],
      reason: !userPoolId ? "missing userPoolId (iss)" : "missing username",
    };
  }

  const client = new CognitoIdentityProviderClient({});

  const res = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: String(userPoolId),
      Username: String(username),
    })
  );

  const groups = (res.Groups ?? [])
    .map((g) => g.GroupName)
    .filter((x): x is string => Boolean(x));

  return { username: String(username), userPoolId: String(userPoolId), groups };
};
