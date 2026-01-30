import {
  CognitoIdentityProviderClient,
  ListGroupsCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { isDeptGroup, keyToLabel } from "../_shared/departmentKey";

const cognito = new CognitoIdentityProviderClient({});

type Dept = { key: string; name: string };

export const handler = async () => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const departments: Dept[] = [];
  let nextToken: string | undefined;

  do {
    const res = await cognito.send(
      new ListGroupsCommand({
        UserPoolId: userPoolId,
        NextToken: nextToken,
        Limit: 60,
      })
    );

    for (const g of res.Groups ?? []) {
      const key = g.GroupName ?? "";
      if (!isDeptGroup(key)) continue;

      const name = (g.Description ?? "").trim() || keyToLabel(key);
      departments.push({ key, name });
    }

    nextToken = res.NextToken;
  } while (nextToken);

  departments.sort((a, b) => a.name.localeCompare(b.name));
  return { departments };
};
