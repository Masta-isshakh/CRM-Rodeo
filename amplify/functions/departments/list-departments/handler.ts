import { CognitoIdentityProviderClient, ListGroupsCommand, type ListGroupsCommandOutput } from "@aws-sdk/client-cognito-identity-provider";
import type { Schema } from "../../../data/resource";

type Handler = Schema["adminListDepartments"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async () => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const out: { name: string; description?: string }[] = [];

  let token: string | undefined = undefined;
  do {
    const res: ListGroupsCommandOutput = await cognito.send(new ListGroupsCommand({ UserPoolId: userPoolId, NextToken: token, Limit: 60 }));
    for (const g of res.Groups ?? []) {
      if (g.GroupName) out.push({ name: g.GroupName, description: g.Description ?? undefined });
    }
    token = res.NextToken;
  } while (token);

  // you can filter internal groups if you want:
  // const filtered = out.filter(g => g.name !== "ADMIN");
  return { ok: true, departments: out.sort((a,b)=>a.name.localeCompare(b.name)) };
};
