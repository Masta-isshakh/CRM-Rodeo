// src/pages/serviceexecution/ApprovalRequestsContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getDataClient } from "../lib/amplifyClient";

// ----- Types -----
export type ApprovalStatusUI = "pending" | "approved" | "rejected";

export type ApprovalRequest = {
  id: string; // Data model id
  jobOrderId: string;
  orderNumber: string;

  serviceId: string;
  serviceName: string;
  price?: number;

  requestedBy?: string | null;
  requestedAt?: string | null;

  status: ApprovalStatusUI;

  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
};

type Ctx = {
  loading: boolean;
  requests: ApprovalRequest[];
  refresh: () => Promise<void>;

  addRequest: (args: {
    jobOrderId: string;
    orderNumber: string;
    serviceId: string;
    serviceName: string;
    price?: number;
    requestedBy?: string;
  }) => Promise<void>;

  updateRequestStatus: (args: {
    requestId: string;
    status: ApprovalStatusUI;
    decidedBy?: string;
    decisionNote?: string;
  }) => Promise<void>;

  removeRequest: (requestId: string) => Promise<void>;
};

const ApprovalRequestsContext = createContext<Ctx | null>(null);

export function useApprovalRequests(): Ctx {
  const ctx = useContext(ApprovalRequestsContext);
  if (!ctx) throw new Error("useApprovalRequests must be used within ApprovalRequestsProvider");
  return ctx;
}

// ----- Helpers -----
function nowIso() {
  return new Date().toISOString();
}

function mapStatusDbToUi(s: any): ApprovalStatusUI {
  const v = String(s ?? "").toUpperCase();
  if (v === "APPROVED") return "approved";
  if (v === "REJECTED") return "rejected";
  return "pending";
}

function mapStatusUiToDb(s: ApprovalStatusUI): "PENDING" | "APPROVED" | "REJECTED" {
  if (s === "approved") return "APPROVED";
  if (s === "rejected") return "REJECTED";
  return "PENDING";
}

// stable deterministic id (no random / Date.now)
function buildRequestId(jobOrderId: string, serviceId: string) {
  const a = String(jobOrderId || "").trim();
  const b = String(serviceId || "").trim();
  return `APR-${a}-${b}`.slice(0, 180);
}

export function ApprovalRequestsProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => getDataClient(), []);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      // Fetch latest PENDING first (you can extend to approved/rejected history)
      const res = await (client.models.ServiceApprovalRequest as any).list({
        limit: 2000,
      });

      const rows = (res?.data ?? []) as any[];

      // normalize
      const mapped: ApprovalRequest[] = rows
        .map((r) => ({
          id: String(r.id),
          jobOrderId: String(r.jobOrderId),
          orderNumber: String(r.orderNumber),
          serviceId: String(r.serviceId),
          serviceName: String(r.serviceName),
          price: typeof r.price === "number" ? r.price : r.price ? Number(r.price) : undefined,
          requestedBy: r.requestedBy ?? null,
          requestedAt: r.requestedAt ?? null,
          status: mapStatusDbToUi(r.status),
          decidedBy: r.decidedBy ?? null,
          decidedAt: r.decidedAt ?? null,
          decisionNote: r.decisionNote ?? null,
        }))
        // newest first
        .sort((a, b) => String(b.requestedAt ?? "").localeCompare(String(a.requestedAt ?? "")));

      setRequests(mapped);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRequest: Ctx["addRequest"] = async (args) => {
    const jobOrderId = String(args.jobOrderId || "").trim();
    const orderNumber = String(args.orderNumber || "").trim();
    const serviceId = String(args.serviceId || "").trim();
    const serviceName = String(args.serviceName || "").trim();
    if (!jobOrderId || !orderNumber || !serviceId || !serviceName) return;

    const id = buildRequestId(jobOrderId, serviceId);
    const ts = nowIso();

    // Upsert style: if exists => update to PENDING again
    setLoading(true);
    try {
      const got = await (client.models.ServiceApprovalRequest as any).get({ id });
      const existing = (got as any)?.data;

      if (existing?.id) {
        await (client.models.ServiceApprovalRequest as any).update({
          id,
          jobOrderId,
          orderNumber,
          serviceId,
          serviceName,
          price: args.price ?? 0,
          requestedBy: args.requestedBy ?? "Unknown",
          requestedAt: ts,
          status: "PENDING",
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        });
      } else {
        await (client.models.ServiceApprovalRequest as any).create({
          id,
          jobOrderId,
          orderNumber,
          serviceId,
          serviceName,
          price: args.price ?? 0,
          requestedBy: args.requestedBy ?? "Unknown",
          requestedAt: ts,
          status: "PENDING",
        });
      }

      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const updateRequestStatus: Ctx["updateRequestStatus"] = async (args) => {
    const requestId = String(args.requestId || "").trim();
    if (!requestId) return;

    setLoading(true);
    try {
      // Need existing to keep fields consistent
      const got = await (client.models.ServiceApprovalRequest as any).get({ id: requestId });
      const row = (got as any)?.data;
      if (!row?.id) return;

      await (client.models.ServiceApprovalRequest as any).update({
        id: requestId,
        status: mapStatusUiToDb(args.status),
        decidedBy: args.decidedBy ?? "System",
        decidedAt: nowIso(),
        decisionNote: args.decisionNote ?? null,
      });

      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const removeRequest: Ctx["removeRequest"] = async (requestId) => {
    const id = String(requestId || "").trim();
    if (!id) return;

    setLoading(true);
    try {
      // Amplify Gen2 data delete
      await (client.models.ServiceApprovalRequest as any).delete({ id });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const value: Ctx = {
    loading,
    requests,
    refresh,
    addRequest,
    updateRequestStatus,
    removeRequest,
  };

  return <ApprovalRequestsContext.Provider value={value}>{children}</ApprovalRequestsContext.Provider>;
}