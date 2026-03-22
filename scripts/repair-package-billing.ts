import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { runOneTimePackageBillingRepair } from "../src/pages/jobOrderRepo";

async function main() {
  Amplify.configure(outputs as any, { ssr: true });

  // NOTE:
  // This script needs valid AWS credentials in your environment
  // (for example via `aws configure sso` + exported profile/session).
  const result = await runOneTimePackageBillingRepair();
  console.log("Package billing repair complete:", result);
}

main().catch((error) => {
  console.error("Package billing repair failed:", error);
  process.exit(1);
});
