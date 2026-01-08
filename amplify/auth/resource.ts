import { defineAuth } from "@aws-amplify/backend";
import { inviteUser } from "../functions/invite-user/resource";

export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  // Your private-app roles
  groups: ["ADMIN", "SALES", "SUPPORT"],

  // Allow the inviteUser function to perform Cognito admin actions
  access: (allow) => [
    allow.resource(inviteUser).to(["createUser", "addUserToGroup"]),
  ],
});
