import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "./amplify_outputs.json" with { type: "json" };

Amplify.configure(outputs, { ssr: true });

const client = generateClient();

function logStep(step, data) {
  console.log(`\n=== ${step} ===`);
  if (data !== undefined) {
    console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  }
}

function unwrapSaveResult(res) {
  let x = res?.data ?? res;
  if (typeof x === "string") {
    try { x = JSON.parse(x); } catch {}
  }
  if (x && typeof x === "object" && x.jobOrderSave != null) {
    x = x.jobOrderSave;
    if (typeof x === "string") {
      try { x = JSON.parse(x); } catch {}
    }
  }
  return {
    id: String(x?.id ?? "").trim(),
    orderNumber: String(x?.orderNumber ?? "").trim(),
  };
}

function verify(label, expected, actual) {
  const pass = expected === actual;
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  return pass;
}

async function getByOrderNumber(orderNumber) {
  const res = await client.models.JobOrder.list({
    filter: { orderNumber: { eq: orderNumber } },
    limit: 1,
  }, {
    authMode: "iam",
  });
  return (res?.data ?? [])[0] ?? null;
}

async function run() {
  const stamp = Date.now();
  const orderNumber = `SMOKE-${stamp}`;

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

    billing: {
      totalAmount: 1500,
      discount: 100,
      netAmount: 1400,
      paymentMethod: "Cash",
      billId: `BILL-${stamp}`,
    },

    services: [
      { id: "SVC-1", name: "Engine Check", price: 500, status: "Pending" },
      { id: "SVC-2", name: "Oil Change", price: 1000, status: "Pending" },
    ],
    documents: [],
    roadmap: [],
  };

  logStep("CREATE payload", createPayload);

  const createRes = await client.mutations.jobOrderSave({
    input: JSON.stringify(createPayload),
  }, {
    authMode: "iam",
  });

  logStep("CREATE mutation raw response", createRes);

  if (createRes?.errors?.length) {
    throw new Error(`Create mutation errors: ${createRes.errors.map((e) => e.message).join(" | ")}`);
  }

  const created = unwrapSaveResult(createRes);
  if (!created.id) {
    throw new Error(`Create succeeded but id not returned. Parsed=${JSON.stringify(created)}`);
  }

  logStep("CREATE parsed response", created);

  const savedCreate = await getByOrderNumber(orderNumber);
  if (!savedCreate) {
    throw new Error("Created row not found in JobOrder list(filter by orderNumber)");
  }

  logStep("CREATE read-back row", {
    id: savedCreate.id,
    orderNumber: savedCreate.orderNumber,
    customerName: savedCreate.customerName,
    priorityLevel: savedCreate.priorityLevel,
    qualityCheckStatus: savedCreate.qualityCheckStatus,
    exitPermitStatus: savedCreate.exitPermitStatus,
    totalServiceCount: savedCreate.totalServiceCount,
    pendingServiceCount: savedCreate.pendingServiceCount,
    customerAddress: savedCreate.customerAddress,
    expectedDeliveryDate: savedCreate.expectedDeliveryDate,
    expectedDeliveryTime: savedCreate.expectedDeliveryTime,
  });

  const updatePayload = {
    ...createPayload,
    id: created.id,
    orderNumber,
    workStatusLabel: "Inprogress",
    status: "IN_PROGRESS",
    priorityLevel: "HIGH",
    qualityCheckStatus: "IN_PROGRESS",
    exitPermitStatus: "APPROVED",
    completedServiceCount: 1,
    pendingServiceCount: 1,
    customerAddress: "Doha - Updated",
    expectedDeliveryTime: "18:00",
  };

  logStep("UPDATE payload", {
    id: updatePayload.id,
    orderNumber: updatePayload.orderNumber,
    status: updatePayload.status,
    priorityLevel: updatePayload.priorityLevel,
    qualityCheckStatus: updatePayload.qualityCheckStatus,
    exitPermitStatus: updatePayload.exitPermitStatus,
    completedServiceCount: updatePayload.completedServiceCount,
    pendingServiceCount: updatePayload.pendingServiceCount,
    customerAddress: updatePayload.customerAddress,
    expectedDeliveryTime: updatePayload.expectedDeliveryTime,
  });

  const updateRes = await client.mutations.jobOrderSave({
    input: JSON.stringify(updatePayload),
  }, {
    authMode: "iam",
  });

  logStep("UPDATE mutation raw response", updateRes);

  if (updateRes?.errors?.length) {
    throw new Error(`Update mutation errors: ${updateRes.errors.map((e) => e.message).join(" | ")}`);
  }

  const updatedParsed = unwrapSaveResult(updateRes);
  logStep("UPDATE parsed response", updatedParsed);

  const savedUpdate = await getByOrderNumber(orderNumber);
  if (!savedUpdate) {
    throw new Error("Updated row not found in JobOrder list(filter by orderNumber)");
  }

  logStep("UPDATE read-back row", {
    id: savedUpdate.id,
    orderNumber: savedUpdate.orderNumber,
    status: savedUpdate.status,
    workStatusLabel: savedUpdate.workStatusLabel,
    priorityLevel: savedUpdate.priorityLevel,
    qualityCheckStatus: savedUpdate.qualityCheckStatus,
    exitPermitStatus: savedUpdate.exitPermitStatus,
    completedServiceCount: savedUpdate.completedServiceCount,
    pendingServiceCount: savedUpdate.pendingServiceCount,
    customerAddress: savedUpdate.customerAddress,
    expectedDeliveryTime: savedUpdate.expectedDeliveryTime,
  });

  console.log("\n=== FIELD VERIFICATION ===");
  const checks = [
    verify("orderNumber", orderNumber, savedUpdate.orderNumber),
    verify("status", "IN_PROGRESS", savedUpdate.status),
    verify("priorityLevel", "HIGH", savedUpdate.priorityLevel),
    verify("qualityCheckStatus", "IN_PROGRESS", savedUpdate.qualityCheckStatus),
    verify("exitPermitStatus", "APPROVED", savedUpdate.exitPermitStatus),
    verify("completedServiceCount", 1, savedUpdate.completedServiceCount),
    verify("pendingServiceCount", 1, savedUpdate.pendingServiceCount),
    verify("customerAddress", "Doha - Updated", savedUpdate.customerAddress),
    verify("expectedDeliveryTime", "18:00", savedUpdate.expectedDeliveryTime),
  ];

  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  console.log(`\nSmoke test result: ${passed}/${total} checks passed`);

  if (passed !== total) {
    process.exitCode = 2;
  }
}

run().catch((err) => {
  console.error("\nSMOKE TEST FAILED:", err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exitCode = 1;
});
