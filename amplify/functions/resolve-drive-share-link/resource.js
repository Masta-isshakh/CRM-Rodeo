import { defineFunction } from "@aws-amplify/backend";
export const resolveDriveShareLink = defineFunction({
    name: "resolve-drive-share-link",
    entry: "./handler.ts",
    runtime: 20,
    timeoutSeconds: 30,
});
