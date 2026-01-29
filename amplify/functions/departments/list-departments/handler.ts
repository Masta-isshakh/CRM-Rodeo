import {
  CognitoIdentityProviderClient,
  ListGroupsCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient();

export const handler = async () => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const res = await cognito.send(new ListGroupsCommand({ UserPoolId: userPoolId, Limit: 60 }));

  const departments = (res.Groups ?? [])
    .map((g) => ({
      key: g.GroupName ?? "",
      name: g.Description || g.GroupName || "",
    }))
    .filter((d) => d.key.startsWith("DEPT_"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { departments };
};
