// amplify/storage/resource.ts
import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "jobOrderFiles",
  access: (allow) => ({
    "job-orders/*": [allow.authenticated.to(["read", "write", "delete"])],
  }),
});