// src/pages/serviceexecution/ApprovalRequestsContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getDataClient } from "../lib/amplifyClient";

export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ApprovalRequest = {
  id: string;
  jobOrderId: string;
  orderNumber: string;

  serviceId: string;
  serviceName: string;
  price: number;

  requestedBy?: string | null;
  requestedAt?: string | null;

  status: ApprovalRequestStatus;

  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;

  createdAt?: string | null;
  updatedAt?: string | null;
};

type AddRequestInput = {
  jobOrderId: string;
  orderNumber: string;
  serviceId: string;
  serviceName: string;
  price: number;
  requestedBy?: string;
};

type Ctx = {
  requests: ApprovalRequest[];
  loading: boolean;

  addRequest: (input: AddRequestInput) => Promise<ApprovalRequest | null>;
  updateRequestStatus: (id: string, status: ApprovalRequestStatus, decidedBy?: string, note?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const ApprovalRequestsContext = createContext<Ctx | null>(null);

export function useApprovalRequests(): Ctx {
  const v = useContext(ApprovalRequestsContext);
  if (!v) throw new Error("useApprovalRequests must be used within ApprovalRequestsProvider");
  return v;
}

function toIso(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function toNum(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function mapRow(r: any): ApprovalRequest {
  return {
    id: String(r.id),
    jobOrderId: String(r.jobOrderId),
    orderNumber: String(r.orderNumber),

    serviceId: String(r.serviceId),
    serviceName: String(r.serviceName),
    price: toNum(r.price),

    requestedBy: r.requestedBy ?? null,
    requestedAt: toIso(r.requestedAt),

    status: (r.status ?? "PENDING") as ApprovalRequestStatus,

    decidedBy: r.decidedBy ?? null,
    decidedAt: toIso(r.decidedAt),
    decisionNote: r.decisionNote ?? null,

    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export function ApprovalRequestsProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => getDataClient(), []);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Live subscription
  useEffect(() => {
    setLoading(true);

    const sub = (client.models.ServiceApprovalRequest as any)
      .observeQuery({ limit: 2000 })
      .subscribe(({ items }: any) => {
        const mapped = (items ?? []).map(mapRow);
        // newest first (by requestedAt / createdAt)
        mapped.sort((a: ApprovalRequest, b: ApprovalRequest) => String(b.requestedAt ?? b.createdAt ?? "").localeCompare(String(a.requestedAt ?? a.createdAt ?? "")));
        setRequests(mapped);
        setLoading(false);
      });

    return () => sub.unsubscribe();
  }, [client]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await client.models.ServiceApprovalRequest.list({ limit: 2000 });
      const mapped = (res.data ?? []).map(mapRow);
      mapped.sort((a: ApprovalRequest, b: ApprovalRequest) => String(b.requestedAt ?? b.createdAt ?? "").localeCompare(String(a.requestedAt ?? a.createdAt ?? "")));
      setRequests(mapped);
    } finally {
      setLoading(false);
    }
  };

  const addRequest = async (input: AddRequestInput): Promise<ApprovalRequest | null> => {
    const payload: any = {
      jobOrderId: String(input.jobOrderId),
      orderNumber: String(input.orderNumber),

      serviceId: String(input.serviceId),
      serviceName: String(input.serviceName),
      price: Number(input.price || 0),

      requestedBy: input.requestedBy ? String(input.requestedBy) : undefined,
      requestedAt: new Date().toISOString(),

      status: "PENDING",
    };

    const created = await (client.models.ServiceApprovalRequest as any).create(payload);
    const row = (created as any)?.data ?? created;
    return row?.id ? mapRow(row) : null;
  };

  const updateRequestStatus = async (id: string, status: ApprovalRequestStatus, decidedBy?: string, note?: string) => {
    await (client.models.ServiceApprovalRequest as any).update({
      id: String(id),
      status,
      decidedBy: decidedBy ? String(decidedBy) : undefined,
      decidedAt: new Date().toISOString(),
      decisionNote: note ? String(note) : undefined,
    });
  };

  const value: Ctx = {
    requests,
    loading,
    addRequest,
    updateRequestStatus,
    refresh,
  };

  return <ApprovalRequestsContext.Provider value={value}>{children}</ApprovalRequestsContext.Provider>;
}