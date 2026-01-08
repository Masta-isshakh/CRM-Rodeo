import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

import { CfnUserPool } from "aws-cdk-lib/aws-cognito";

const backend = defineBackend({
  auth,
  data,
});

// Lock down Cognito: admin-only user creation
const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool as CfnUserPool;

cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
  // Optional: customize the invite email
  inviteMessageTemplate: {
    emailSubject: "Rodeo Drive CRM — Your account invitation",
    emailMessage:
      "Hello {username}, you have been invited to Rodeo Drive CRM.\n\n" +
      "Temporary password: {####}\n\n" +
      "Sign in with your email and this temporary password, then you will be asked to set your own password.\n",
  },
};
