import { useEffect, useMemo, useState } from "react";
import { getDataClient } from "../lib/amplifyClient";
import { formatCustomerDisplayId } from "../utils/customerId";

function nonEmpty(...values: any[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function valueOrDefault(value: any, fallback = "Not provided") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function numericOrZero(value: any) {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "0";
}

function normalizeHeardFrom(value: any) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "refer_person" || normalized === "refer_by_person" || normalized === "referred_by_person") {
    return "refer_person";
  }
  if (normalized === "social_media" || normalized === "socialmedia") {
    return "social_media";
  }
  if (normalized === "walk_in" || normalized === "walkin") {
    return "walk_in";
  }
  if (normalized === "other") {
    return "other";
  }
  return normalized;
}

function heardFromLabel(value: any) {
  const normalized = normalizeHeardFrom(value);
  if (normalized === "walk_in") return "Walk-in";
  if (normalized === "refer_person") return "Referred by person";
  if (normalized === "social_media") return "Social media";
  if (normalized === "other") return "Other";
  return String(value ?? "").trim() || "Not provided";
}

export function UnifiedCustomerInfoCard({ order, className = "" }: { order: any; className?: string }) {
  const client = useMemo(() => getDataClient(), []);
  const customerDetails = order?.customerDetails || {};
  const customerIdForBackend = nonEmpty(customerDetails?.customerId, order?.customerId).replace(/^N\/A$/i, "");

  const [backendCustomerMeta, setBackendCustomerMeta] = useState<{
    id?: string;
    name?: string;
    lastname?: string;
    phone?: string;
    email?: string;
    notes?: string;
    heardFrom?: string;
    referralPersonName?: string;
    referralPersonMobile?: string;
    socialPlatform?: string;
    heardFromOtherNote?: string;
    createdAt?: string;
  } | null>(null);
  const [registeredVehiclesCountBackend, setRegisteredVehiclesCountBackend] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCustomerMeta = async () => {
      if (!customerIdForBackend) {
        if (!cancelled) {
          setBackendCustomerMeta(null);
          setRegisteredVehiclesCountBackend(null);
        }
        return;
      }

      try {
        const res = await client.models.Customer.get({ id: customerIdForBackend } as any);
        const row = (res as any)?.data as any;

        if (!cancelled) {
          if (row?.id) {
            setBackendCustomerMeta({
              id: String(row.id ?? "").trim(),
              name: String(row.name ?? "").trim(),
              lastname: String(row.lastname ?? "").trim(),
              phone: String(row.phone ?? "").trim(),
              email: String(row.email ?? "").trim(),
              notes: String(row.notes ?? "").trim(),
              heardFrom: String(row.heardFrom ?? "").trim(),
              referralPersonName: String(row.referralPersonName ?? "").trim(),
              referralPersonMobile: String(row.referralPersonMobile ?? "").trim(),
              socialPlatform: String(row.socialPlatform ?? "").trim(),
              heardFromOtherNote: String(row.heardFromOtherNote ?? "").trim(),
              createdAt: String(row.createdAt ?? "").trim(),
            });
          } else {
            setBackendCustomerMeta(null);
          }
        }

        try {
          let count = 0;
          const byIdx = await (client.models.Vehicle as any)?.vehiclesByCustomer?.({
            customerId: customerIdForBackend,
            limit: 2000,
          });
          if (Array.isArray(byIdx?.data)) count = byIdx.data.length;
          if (!cancelled) setRegisteredVehiclesCountBackend(count);
        } catch {
          const listRes = await client.models.Vehicle.list({
            filter: { customerId: { eq: customerIdForBackend } } as any,
            limit: 2000,
          });
          if (!cancelled) setRegisteredVehiclesCountBackend((listRes?.data ?? []).length);
        }
      } catch {
        if (!cancelled) {
          setBackendCustomerMeta(null);
          setRegisteredVehiclesCountBackend(null);
        }
      }
    };

    void loadCustomerMeta();

    return () => {
      cancelled = true;
    };
  }, [client, customerIdForBackend]);

  const backendCustomerFullName = nonEmpty(backendCustomerMeta?.name, backendCustomerMeta?.lastname)
    ? `${String(backendCustomerMeta?.name ?? "").trim()} ${String(backendCustomerMeta?.lastname ?? "").trim()}`.trim()
    : "";

  const customerId = formatCustomerDisplayId(nonEmpty(customerDetails?.customerId, order?.customerId, backendCustomerMeta?.id));
  const customerName = valueOrDefault(nonEmpty(order?.customerName, customerDetails?.name, backendCustomerFullName), "—");
  const customerMobile = valueOrDefault(nonEmpty(order?.mobile, customerDetails?.mobile, backendCustomerMeta?.phone));
  const customerEmail = valueOrDefault(nonEmpty(customerDetails?.email, order?.customerEmail, backendCustomerMeta?.email));
  const homeAddress = valueOrDefault(nonEmpty(customerDetails?.address, order?.customerAddress, backendCustomerMeta?.notes));

  const heardFromSource = nonEmpty(backendCustomerMeta?.heardFrom, customerDetails?.heardFrom);
  const heardFromNormalized = normalizeHeardFrom(heardFromSource);
  const heardFrom = heardFromLabel(heardFromSource);
  const referredPersonName = valueOrDefault(nonEmpty(backendCustomerMeta?.referralPersonName, customerDetails?.referralPersonName));
  const referredPersonMobile = valueOrDefault(nonEmpty(backendCustomerMeta?.referralPersonMobile, customerDetails?.referralPersonMobile));
  const socialPlatform = valueOrDefault(nonEmpty(backendCustomerMeta?.socialPlatform, customerDetails?.socialPlatform));
  const heardFromOtherNote = valueOrDefault(nonEmpty(backendCustomerMeta?.heardFromOtherNote, customerDetails?.heardFromOtherNote));

  const registeredVehicles = numericOrZero(
    registeredVehiclesCountBackend ?? customerDetails?.registeredVehiclesCount ?? order?.registeredVehiclesCount
  );
  const completedServices = numericOrZero(customerDetails?.completedServicesCount ?? order?.completedServicesCount);

  const backendCustomerSince = backendCustomerMeta?.createdAt
    ? new Date(String(backendCustomerMeta.createdAt)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
  const customerSince = valueOrDefault(nonEmpty(customerDetails?.customerSince, order?.customerSince, backendCustomerSince), "—");

  return (
    <div className={`pim-detail-card ${className}`.trim()}>
      <h3>Customer Information</h3>
      <div className="pim-card-content">
        <div className="pim-info-item">
          <span className="pim-info-label">Customer ID</span>
          <span className="pim-info-value">{customerId}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Customer Name</span>
          <span className="pim-info-value">{customerName}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Mobile Number</span>
          <span className="pim-info-value">{customerMobile}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Email Address</span>
          <span className="pim-info-value">{customerEmail}</span>
        </div>
        <div className="pim-info-item" style={{ gridColumn: "span 2" }}>
          <span className="pim-info-label">Home Address</span>
          <span className="pim-info-value">{homeAddress}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Heard of Us From</span>
          <span className="pim-info-value">{heardFrom}</span>
        </div>
        {heardFromNormalized === "refer_person" && (
          <>
            <div className="pim-info-item">
              <span className="pim-info-label">Referred Person Name</span>
              <span className="pim-info-value">{referredPersonName}</span>
            </div>
            <div className="pim-info-item">
              <span className="pim-info-label">Referred Person Mobile</span>
              <span className="pim-info-value">{referredPersonMobile}</span>
            </div>
          </>
        )}
        {heardFromNormalized === "social_media" && (
          <div className="pim-info-item">
            <span className="pim-info-label">Social Platform</span>
            <span className="pim-info-value">{socialPlatform}</span>
          </div>
        )}
        {heardFromNormalized === "other" && (
          <div className="pim-info-item" style={{ gridColumn: "span 2" }}>
            <span className="pim-info-label">Heard From Other Note</span>
            <span className="pim-info-value">{heardFromOtherNote}</span>
          </div>
        )}
        <div className="pim-info-item">
          <span className="pim-info-label">Registered Vehicles</span>
          <span className="pim-info-value">{registeredVehicles}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Completed Services</span>
          <span className="pim-info-value">{completedServices}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Customer Since</span>
          <span className="pim-info-value">{customerSince}</span>
        </div>
      </div>
    </div>
  );
}

export function UnifiedVehicleInfoCard({ order, className = "" }: { order: any; className?: string }) {
  const client = useMemo(() => getDataClient(), []);
  const vehicleDetails = order?.vehicleDetails || {};

  const rawInternalVehicleId = String(vehicleDetails?.id ?? "").trim();
  const vehicleIdLookup = nonEmpty(vehicleDetails?.vehicleId, order?.vehicleId);
  const plateLookup = nonEmpty(order?.vehiclePlate, vehicleDetails?.plateNumber, vehicleDetails?.plate);

  const [backendVehicle, setBackendVehicle] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    const loadVehicle = async () => {
      try {
        let row: any = null;

        if (rawInternalVehicleId) {
          const getRes = await client.models.Vehicle.get({ id: rawInternalVehicleId } as any);
          row = (getRes as any)?.data ?? null;
        }

        if (!row && plateLookup) {
          try {
            const byIndex = await (client.models.Vehicle as any)?.vehiclesByPlateNumber?.({
              plateNumber: plateLookup,
              limit: 1,
            });
            row = (byIndex?.data ?? [])[0] ?? null;
          } catch {
            const listRes = await client.models.Vehicle.list({
              filter: { plateNumber: { eq: plateLookup } } as any,
              limit: 1,
            });
            row = (listRes?.data ?? [])[0] ?? null;
          }
        }

        if (!row && vehicleIdLookup) {
          const listRes = await client.models.Vehicle.list({
            filter: { vehicleId: { eq: vehicleIdLookup } } as any,
            limit: 1,
          });
          row = (listRes?.data ?? [])[0] ?? null;
        }

        if (!cancelled) setBackendVehicle(row);
      } catch {
        if (!cancelled) setBackendVehicle(null);
      }
    };

    void loadVehicle();

    return () => {
      cancelled = true;
    };
  }, [client, plateLookup, rawInternalVehicleId, vehicleIdLookup]);

  const vehicleId =
    valueOrDefault(
      nonEmpty(
        backendVehicle?.vehicleId,
        vehicleDetails?.vehicleId,
        vehicleDetails?.id,
        order?.vehicleId,
        order?.vehicleDetails?.vehicleId
      ),
      "—"
    );
  const ownedBy = valueOrDefault(nonEmpty(backendVehicle?.ownedBy, vehicleDetails?.ownedBy, order?.customerName), "—");
  const make = valueOrDefault(nonEmpty(backendVehicle?.make, vehicleDetails?.make, vehicleDetails?.factory), "—");
  const model = valueOrDefault(nonEmpty(backendVehicle?.model, vehicleDetails?.model), "—");
  const year = valueOrDefault(nonEmpty(backendVehicle?.year, vehicleDetails?.year), "—");
  const color = valueOrDefault(nonEmpty(backendVehicle?.color, vehicleDetails?.color), "—");
  const plateNumber = valueOrDefault(nonEmpty(backendVehicle?.plateNumber, order?.vehiclePlate, vehicleDetails?.plateNumber, vehicleDetails?.plate));
  const vin = valueOrDefault(nonEmpty(backendVehicle?.vin, vehicleDetails?.vin));
  const vehicleType = valueOrDefault(nonEmpty(backendVehicle?.vehicleType, vehicleDetails?.type, vehicleDetails?.vehicleType, vehicleDetails?.carType), "—");

  return (
    <div className={`pim-detail-card ${className}`.trim()}>
      <h3>Vehicle Information</h3>
      <div className="pim-card-content">
        <div className="pim-info-item">
          <span className="pim-info-label">Vehicle ID</span>
          <span className="pim-info-value">{vehicleId}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Owned By</span>
          <span className="pim-info-value">{ownedBy}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Make</span>
          <span className="pim-info-value">{make}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Model</span>
          <span className="pim-info-value">{model}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Year</span>
          <span className="pim-info-value">{year}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Color</span>
          <span className="pim-info-value">{color}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Plate Number</span>
          <span className="pim-info-value">{plateNumber}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">VIN</span>
          <span className="pim-info-value">{vin}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Vehicle Type</span>
          <span className="pim-info-value">{vehicleType}</span>
        </div>
      </div>
    </div>
  );
}
