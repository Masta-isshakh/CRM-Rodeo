import { defineAuth } from "@aws-amplify/backend";
import { inviteUser } from "../functions/invite-user/resource";
import { customMessage } from "./custom-message/resource";


export const auth = defineAuth({
  loginWith: {
    email: true,
  },
    triggers: {
    customMessage,
  },

  // Your private-app roles
  groups: ["ADMIN", "SALES", "SALES_MANAGER", "SUPPORT"],

  // Allow the inviteUser function to perform Cognito admin actions
  access: (allow) => [
    allow.resource(inviteUser).to(["createUser", "addUserToGroup"]),
  ],
});
