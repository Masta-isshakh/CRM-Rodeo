import outputs from "./amplify_outputs.json" with { type: "json" };
import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession } from "aws-amplify/auth";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminInitiateAuthCommand,
  InitiateAuthCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const region = outputs.auth.aws_region;
const userPoolId = outputs.auth.user_pool_id;
const clientId = outputs.auth.user_pool_client_id;
const graphqlUrl = outputs.data.url;

const cip = new CognitoIdentityProviderClient({ region });
Amplify.configure(outputs, { ssr: true });

function stamp() {
  return `${Date.now()}`;
}

function pass(label, ok, details) {
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${details ? ` | ${details}` : ""}`);
}

async function gql(token, query, variables = {}) {
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

function parseSaveResult(raw) {
  let x = raw;
  if (typeof x === "string") {
    try { x = JSON.parse(x); } catch {}
  }
  return {
    id: String(x?.id ?? "").trim(),
    orderNumber: String(x?.orderNumber ?? "").trim(),
  };
}

async function getIdTokenWithFallbacks(username, password) {
  const authErrors = [];

  try {
    const adminAuth = await cip.send(new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    }));
    const tok = adminAuth.AuthenticationResult?.IdToken;
    if (tok) return tok;
  } catch (e) {
    authErrors.push(`ADMIN_USER_PASSWORD_AUTH: ${e?.message || e}`);
  }

  try {
    const userAuth = await cip.send(new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    }));
    const tok = userAuth.AuthenticationResult?.IdToken;
    if (tok) return tok;
  } catch (e) {
    authErrors.push(`USER_PASSWORD_AUTH: ${e?.message || e}`);
  }

  try {
    const signInRes = await signIn({ username, password });
    if (signInRes?.nextStep?.signInStep && signInRes.nextStep.signInStep !== "DONE") {
      throw new Error(`Unexpected sign-in step: ${signInRes.nextStep.signInStep}`);
    }
    const session = await fetchAuthSession({ forceRefresh: true });
    const tok = session.tokens?.idToken?.toString();
    if (tok) return tok;
  } catch (e) {
    authErrors.push(`AMPLIFY_SIGN_IN: ${e?.message || e}`);
  }

  throw new Error(`Could not obtain User Pool token. ${authErrors.join(" | ")}`);
}

async function run() {
  const key = stamp();
  const username = `smoke.joborder.${key}@example.com`;
  const password = `Tmp#${key}Aa!`;
  const orderNumber = `SMOKE-${key}`;

  console.log("Using user:", username);
  console.log("Order number:", orderNumber);

  try {
    // Create temp user + grant Admins group for RBAC in Lambda
    await cip.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      MessageAction: "SUPPRESS",
      TemporaryPassword: password,
      UserAttributes: [
        { Name: "email", Value: username },
        { Name: "email_verified", Value: "true" },
      ],
    }));

    await cip.send(new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }));

    await cip.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: "Admins",
    }));

    const idToken = await getIdTokenWithFallbacks(username, password);

  const createPayload = {
    orderNumber,
    orderType: "Job Order",
    status: "OPEN",
    workStatusLabel: "New Request",
    paymentStatusLabel: "Unpaid",
    customerName: "Smoke Test Customer",
    customerPhone: "+97450000001",
    customerEmail: "smoke@example.com",
    customerAddress: "Doha",
    customerCompany: "Smoke Co",
    customerSince: "2026-01-01",
    registeredVehiclesCount: 2,
    completedServicesCount: 5,
    plateNumber: "SMK-1001",
    vehicleType: "SUV_4X4",
    vehicleMake: "Toyota",
    vehicleModel: "Prado",
    vehicleYear: "2023",
    mileage: "12000",
    priorityLevel: "NORMAL",
    qualityCheckStatus: "PENDING",
    exitPermitRequired: true,
    exitPermitStatus: "PENDING",
    totalServiceCount: 2,
    completedServiceCount: 0,
    pendingServiceCount: 2,
    expectedDeliveryDate: "2026-12-30",
    expectedDeliveryTime: "16:30",
    billId: `BILL-${key}`,
    totalAmount: 1500,
    netAmount: 1400,
    paymentMethod: "Cash",
    services: [
      { id: "SVC-1", name: "Engine Check", price: 500, status: "Pending" },
      { id: "SVC-2", name: "Oil Change", price: 1000, status: "Pending" },
    ],
    documents: [],
    roadmap: [],
  };

  const saveMutation = `
    mutation JobOrderSave($input: AWSJSON!) {
      jobOrderSave(input: $input)
    }
  `;

  const byOrderQuery = `
    query JobOrdersByOrderNumber($orderNumber: String!, $limit: Int) {
      jobOrdersByOrderNumber(orderNumber: $orderNumber, limit: $limit) {
        items {
          id
          orderNumber
          status
          workStatusLabel
          priorityLevel
          qualityCheckStatus
          exitPermitStatus
          completedServiceCount
          pendingServiceCount
          customerAddress
          expectedDeliveryTime
        }
      }
    }
  `;

    const createData = await gql(idToken, saveMutation, { input: JSON.stringify(createPayload) });
    const created = parseSaveResult(createData.jobOrderSave);
    if (!created.id) throw new Error(`Create did not return id: ${JSON.stringify(createData)}`);

    const createdRowData = await gql(idToken, byOrderQuery, { orderNumber, limit: 1 });
    const createdRow = createdRowData?.jobOrdersByOrderNumber?.items?.[0];
    if (!createdRow) throw new Error("Created row not found by orderNumber");

  const updatePayload = {
    ...createPayload,
    id: created.id,
    status: "IN_PROGRESS",
    workStatusLabel: "Inprogress",
    priorityLevel: "HIGH",
    qualityCheckStatus: "IN_PROGRESS",
    exitPermitStatus: "APPROVED",
    completedServiceCount: 1,
    pendingServiceCount: 1,
    customerAddress: "Doha - Updated",
    expectedDeliveryTime: "18:00",
  };

    const updateData = await gql(idToken, saveMutation, { input: JSON.stringify(updatePayload) });
    const updated = parseSaveResult(updateData.jobOrderSave);
    if (!updated.id) throw new Error(`Update did not return id: ${JSON.stringify(updateData)}`);

    const updatedRowData = await gql(idToken, byOrderQuery, { orderNumber, limit: 1 });
    const row = updatedRowData?.jobOrdersByOrderNumber?.items?.[0];
    if (!row) throw new Error("Updated row not found by orderNumber");

    console.log("\nField verification");
    pass("orderNumber", row.orderNumber === orderNumber, `actual=${row.orderNumber}`);
    pass("status", row.status === "IN_PROGRESS", `actual=${row.status}`);
    pass("workStatusLabel", row.workStatusLabel === "Inprogress", `actual=${row.workStatusLabel}`);
    pass("priorityLevel", row.priorityLevel === "HIGH", `actual=${row.priorityLevel}`);
    pass("qualityCheckStatus", row.qualityCheckStatus === "IN_PROGRESS", `actual=${row.qualityCheckStatus}`);
    pass("exitPermitStatus", row.exitPermitStatus === "APPROVED", `actual=${row.exitPermitStatus}`);
    pass("completedServiceCount", row.completedServiceCount === 1, `actual=${row.completedServiceCount}`);
    pass("pendingServiceCount", row.pendingServiceCount === 1, `actual=${row.pendingServiceCount}`);
    pass("customerAddress", row.customerAddress === "Doha - Updated", `actual=${row.customerAddress}`);
    pass("expectedDeliveryTime", row.expectedDeliveryTime === "18:00", `actual=${row.expectedDeliveryTime}`);

    console.log("\nSmoke test completed successfully.");
  } finally {
    try {
      await cip.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
      console.log("Temporary user deleted.");
    } catch (cleanupErr) {
      console.warn("Temporary user cleanup failed:", cleanupErr?.message || cleanupErr);
    }
  }
}

run().catch(async (err) => {
  console.error("SMOKE TEST FAILED:", err?.message || err);
  process.exitCode = 1;
});
