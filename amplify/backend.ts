import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

import { inviteUser } from "./functions/invite-user/resource";
import { setUserActive } from "./functions/set-user-active/resource";
import { deleteUser } from "./functions/delete-user/resource";

import { listDepartments } from "./functions/departments/list-departments/resource";
import { createDepartment } from "./functions/departments/create-department/resource";
import { deleteDepartment } from "./functions/departments/delete-department/resource";
import { renameDepartment } from "./functions/departments/rename-department/resource";
import { setUserDepartment } from "./functions/departments/set-user-department/resource";

import { myGroups } from "./functions/auth/my-groups/resource";

const backend = defineBackend({
  auth,
  data,

  inviteUser,
  setUserActive,
  deleteUser,

  listDepartments,
  createDepartment,
  deleteDepartment,
  renameDepartment,
  setUserDepartment,

  myGroups,
});

// ---- myGroups Lambda needs permission to read Cognito groups ----
// Gen2 often types resources.lambda as an interface; cast to CDK Function to use helpers. :contentReference[oaicite:1]{index=1}
const myGroupsFn = backend.myGroups.resources.lambda as unknown as lambda.Function;

myGroupsFn.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:AdminListGroupsForUser"],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// Optional (handler already falls back to AMPLIFY_AUTH_USERPOOL_ID, but this is fine too)
myGroupsFn.addEnvironment("USER_POOL_ID", backend.auth.resources.userPool.userPoolId);
