import {
  CognitoIdentityProviderClient,
  DeleteGroupCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../../data/resource";

type Handler = Schema["adminDeleteDepartment"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event) => {
  const name = event.arguments.departmentName.trim();
  if (!name) throw new Error("departmentName required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  // safety: refuse deleting ADMIN group
  if (name === "ADMIN") throw new Error("Cannot delete ADMIN department.");

  // check if group has users (optional)
  const users = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: name, Limit: 1 }));
  if ((users.Users ?? []).length > 0) {
    throw new Error("Cannot delete: department has users. Move users first.");
  }

  // cleanup mappings in Data
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const links = await dataClient.models.DepartmentRoleLink.list({
    filter: { departmentName: { eq: name } },
    limit: 5000,
  });
  for (const l of links.data) {
    await dataClient.models.DepartmentRoleLink.delete({ id: l.id });
  }

  // delete group
  await cognito.send(new DeleteGroupCommand({ UserPoolId: userPoolId, GroupName: name }));

  return { ok: true, deleted: true, name };
};
