// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { adminCognito } from "./functions/adminCognito/resource";

const backend = defineBackend({
  auth,
  data,
  adminCognito,
});

// Give the function permission to manage Cognito Groups + Users
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";

backend.adminCognito.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:ListGroups",
      "cognito-idp:CreateGroup",
      "cognito-idp:DeleteGroup",
      "cognito-idp:GetGroup",
      "cognito-idp:UpdateGroup",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:ListUsersInGroup",
    ],
    resources: ["*"],
  })
);

// Inject USERPOOL_ID into function env
backend.adminCognito.resources.cfnResources.cfnFunction.environment = {
  variables: {
    USERPOOL_ID: backend.auth.resources.userPool.userPoolId,
    DEPT_PREFIX: "dept_", // your department group prefix
    ADMINS_GROUP: "Admins",
  },
};
