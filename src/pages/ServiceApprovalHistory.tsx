// src/pages/serviceexecution/ServiceApprovalHistory.tsx
import React, { useEffect, useMemo, useState } from "react";
import "./ServiceApprovalHistory.css";
import PermissionGate from "./PermissionGate";
import { getDataClient } from "../lib/amplifyClient";

type Decision = "approved" | "declined" | "pending";

type HistoryRow = {
  // UI keys
  id: string;             // Job Card ID (orderNumber)
  requestId: string;      // Approval Request ID (ServiceApprovalRequest.id)

  customer: string;
  contact: string;
  vehicle: string;        // plateNumber

  requestDate: string;    // pretty date
  requestDateTime: string;

  decision: Decision;
  decisionDate: string;
  decisionBy: string;

  assignedTo: string;

  totalAdded: string;
  currentAmount: string;
  proposedAmount: string;
  combinedAmount: string;

  currentServices: { name: string; amount: string }[];
  proposedServices: { name: string; amount: string }[];

  invoice: string;
  newInvoice: string;
  paymentStatus: string;

  requestedBy: string;
  vehicleDetails: string;
  notes?: string;

  // raw ids for lookups
  _jobOrderId: string;
  _approvalId: string;
};

function formatQar(n: number) {
  return `QAR ${Number(n || 0).toLocaleString()}`;
}

function toNum(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(d: Date) {
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function normalizeIdentity(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function parseServicesFromJob(job: any): { name: string; amount: string }[] {
  const parsed = (() => {
    try {
      if (!job?.dataJson) return {};
      return typeof job.dataJson === "string" ? JSON.parse(job.dataJson) : job.dataJson;
    } catch {
      return {};
    }
  })();

  const services = Array.isArray(parsed?.services) ? parsed.services : [];
  return services.map((s: any) => ({
    name: String(s?.name ?? "Service"),
    amount: formatQar(toNum(s?.price ?? s?.unitPrice ?? 0)),
  }));
}

const ServiceApprovalHistory: React.FC = () => {
  const client = useMemo(() => getDataClient(), []);

  const [showHistoryDetails, setShowHistoryDetails] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Filters
  const [historySearch, setHistorySearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"" | "approved" | "declined" | "pending">("");
  const [dateRangeFilter, setDateRangeFilter] = useState<"" | "today" | "week" | "month">("");

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLabelMap, setUserLabelMap] = useState<Record<string, string>>({});

  // Cache JobOrders to avoid repeated gets
  const [jobCache, setJobCache] = useState<Record<string, any>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await (client.models.UserProfile as any).list({ limit: 2000 });
        if (cancelled) return;

        const map: Record<string, string> = {};
        for (const u of res?.data ?? []) {
          const email = normalizeIdentity(u?.email);
          const name = String(u?.fullName ?? u?.name ?? u?.email ?? "").trim();
          if (email && name) map[email] = name;
        }
        setUserLabelMap(map);
      } catch {
        if (!cancelled) setUserLabelMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const displayUser = (value: any) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    const mapped = userLabelMap[normalizeIdentity(raw)];
    return mapped || raw;
  };

  useEffect(() => {
    setLoading(true);

    const sub = (client.models.ServiceApprovalRequest as any)
      .observeQuery({ limit: 2000 })
      .subscribe(async ({ items }: any) => {
        const reqs = items ?? [];

        // fetch joborders for these requests (cache)
        const uniqueJobIds = Array.from(new Set(reqs.map((r: any) => String(r.jobOrderId)).filter(Boolean))) as string[];
        const missing = uniqueJobIds.filter((id: string) => !jobCache[id]);

        if (missing.length) {
          const fetched: Record<string, any> = {};
          // simple sequential to avoid throttling
          for (const id of missing.slice(0, 200)) {
            try {
              const g = await client.models.JobOrder.get({ id } as any);
              const row = (g as any)?.data ?? null;
              if (row?.id) fetched[id as string] = row;
            } catch {}
          }
          if (Object.keys(fetched).length) {
            setJobCache((prev) => ({ ...prev, ...fetched }));
          }
        }

        const mapped: HistoryRow[] = reqs.map((r: any) => {
          const jobId = String(r.jobOrderId);
          const job = jobCache[jobId];

          const orderNumber = String(r.orderNumber ?? "");
          const customerName = String(job?.customerName ?? "");
          const phone = String(job?.customerPhone ?? "");
          const plate = String(job?.plateNumber ?? "");
          const vehicleDetails = [job?.vehicleMake, job?.vehicleModel, job?.vehicleYear].filter(Boolean).join(" ");

          const requestedAt = r.requestedAt ? new Date(String(r.requestedAt)) : (r.createdAt ? new Date(String(r.createdAt)) : new Date());
          const decidedAt = r.decidedAt ? new Date(String(r.decidedAt)) : null;

          const status = String(r.status ?? "PENDING").toUpperCase();
          const decision: Decision = status === "APPROVED" ? "approved" : status === "REJECTED" ? "declined" : "pending";

          const jobTotal = toNum(job?.totalAmount ?? 0);
          const price = toNum(r.price ?? 0);

          const currentServices = job ? parseServicesFromJob(job) : [];
          const proposedServices = [{ name: String(r.serviceName ?? "Service"), amount: formatQar(price) }];

          return {
            id: orderNumber || "(no orderNumber)",
            requestId: String(r.id),

            customer: customerName || "—",
            contact: phone || "—",
            vehicle: plate || "—",

            requestDate: fmtDate(requestedAt),
            requestDateTime: fmtDateTime(requestedAt),

            decision,
            decisionDate: decidedAt ? fmtDateTime(decidedAt) : "—",
            decisionBy: String(r.decidedBy ?? "—"),

            assignedTo: String(r.requestedBy ?? "—"),

            totalAdded: formatQar(price),
            currentAmount: formatQar(jobTotal),
            proposedAmount: formatQar(price),
            combinedAmount: formatQar(jobTotal + price),

            currentServices,
            proposedServices,

            invoice: String(job?.billId ?? "—"),
            newInvoice: "",
            paymentStatus: String(job?.paymentStatus ?? "—"),

            requestedBy: String(r.requestedBy ?? "—"),
            vehicleDetails: vehicleDetails || "—",
            notes: String(r.decisionNote ?? ""),

            _jobOrderId: jobId,
            _approvalId: String(r.id),
          };
        });

        // newest first
        mapped.sort((a, b) => String(b.requestDateTime).localeCompare(String(a.requestDateTime)));

        setRows(mapped);
        setLoading(false);
      });

    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    return rows.filter((h) => {
      const matchesSearch =
        !q ||
        h.id.toLowerCase().includes(q) ||
        h.customer.toLowerCase().includes(q) ||
        h.vehicle.toLowerCase().includes(q) ||
        h.requestId.toLowerCase().includes(q) ||
        h.decision.toLowerCase().includes(q);

      const matchesDecision = !decisionFilter || h.decision === decisionFilter;

      let matchesDate = true;
      if (dateRangeFilter) {
        const dt = new Date(h.requestDateTime);
        if (dateRangeFilter === "today") matchesDate = dt >= startOfToday;
        if (dateRangeFilter === "week") matchesDate = dt >= daysAgo(7);
        if (dateRangeFilter === "month") matchesDate = dt >= daysAgo(30);
      }

      return matchesSearch && matchesDecision && matchesDate;
    });
  }, [rows, historySearch, decisionFilter, dateRangeFilter]);

  const getCurrentHistory = () => filteredHistory.find((r) => r.id === currentRequestId) ?? rows.find((r) => r.id === currentRequestId);

  const viewHistoryDetails = (jobCardId: string) => {
    setCurrentRequestId(jobCardId);
    setShowHistoryDetails(true);
  };

  const backToDashboard = () => {
    setShowHistoryDetails(false);
  };

  const clearHistoryFilters = () => {
    setHistorySearch("");
    setDecisionFilter("");
    setDateRangeFilter("");
  };

  if (showHistoryDetails) {
    const history = getCurrentHistory();
    if (!history) return null;

    return (
      <div className="sah-details-page">
        <div className="sah-details-header">
          <h1>Request History Details</h1>
          <button className="sah-back-btn" onClick={backToDashboard}>
            <i className="fas fa-arrow-left"></i> Back to History
          </button>
        </div>

        <div className="sah-details-container">
          <div className="sah-details-section">
            <h2 className="sah-section-title">Request Summary</h2>
            <div className="sah-details-grid">
              <div className="sah-detail-item">
                <div className="sah-detail-label">Request ID</div>
                <div className="sah-detail-value">{history.requestId}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Job Card ID</div>
                <div className="sah-detail-value">{history.id}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Status</div>
                <div className="sah-detail-value">
                  <span
                    className={`sah-status-badge ${
                      history.decision === "approved"
                        ? "sah-status-approved"
                        : history.decision === "declined"
                        ? "sah-status-declined"
                        : "sah-status-pending"
                    }`}
                  >
                    {history.decision === "approved" ? "Approved" : history.decision === "declined" ? "Declined" : "Pending"}
                  </span>
                </div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Decision By</div>
                <div className="sah-detail-value">{displayUser(history.decisionBy)}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Decision Date</div>
                <div className="sah-detail-value">{history.decisionDate}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Requested By</div>
                <div className="sah-detail-value">{displayUser(history.requestedBy)}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Request Date</div>
                <div className="sah-detail-value">{history.requestDateTime}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Customer Name</div>
                <div className="sah-detail-value">{history.customer}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Mobile Number</div>
                <div className="sah-detail-value">{history.contact}</div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Vehicle Plate</div>
                <div className="sah-detail-value">
                  {history.vehicle} ({history.vehicleDetails})
                </div>
              </div>
              <div className="sah-detail-item">
                <div className="sah-detail-label">Assigned To</div>
                <div className="sah-detail-value">{displayUser(history.assignedTo)}</div>
              </div>
            </div>
          </div>

          <div className="sah-details-section">
            <h2 className="sah-section-title">Financial Overview</h2>
            <div className="sah-financial-cards">
              <div className="sah-financial-card sah-current">
                <div className="sah-financial-card-header">
                  <div className="sah-financial-card-title">Current Job Total</div>
                  <div className="sah-financial-card-amount">{history.currentAmount}</div>
                </div>
                <div className="sah-detail-label">Bill ID: <span>{history.invoice}</span></div>
                <ul className="sah-service-list">
                  {history.currentServices.map((service, idx) => (
                    <li key={idx}>
                      <span className="sah-service-name">{service.name}</span>
                      <span className="sah-service-amount">{service.amount}</span>
                    </li>
                  ))}
                </ul>
                <div className="sah-detail-label" style={{ marginTop: 12 }}>
                  Payment Status: <strong>{history.paymentStatus}</strong>
                </div>
              </div>

              <div className="sah-financial-card sah-proposed">
                <div className="sah-financial-card-header">
                  <div className="sah-financial-card-title">Requested Service</div>
                  <div className="sah-financial-card-amount">{history.proposedAmount}</div>
                </div>
                <ul className="sah-service-list">
                  {history.proposedServices.map((service, idx) => (
                    <li key={idx}>
                      <span className="sah-service-name">{service.name}</span>
                      <span className="sah-service-amount">{service.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="sah-financial-card sah-combined">
                <div className="sah-financial-card-header">
                  <div className="sah-financial-card-title">Combined Total (estimate)</div>
                  <div className="sah-financial-card-amount">{history.combinedAmount}</div>
                </div>
                <div className="sah-service-breakdown">
                  <div className="sah-breakdown-item">
                    <span>Current total:</span>
                    <span>{history.currentAmount}</span>
                  </div>
                  <div className="sah-breakdown-item">
                    <span>Requested:</span>
                    <span>{history.proposedAmount}</span>
                  </div>
                  <div className="sah-breakdown-divider"></div>
                  <div className="sah-breakdown-item sah-total">
                    <span><strong>Estimate:</strong></span>
                    <span><strong>{history.combinedAmount}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {history.notes ? (
            <div className="sah-details-section">
              <h2 className="sah-section-title">Decision Note</h2>
              <div className="sah-notes-content">{history.notes}</div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sah-container">
      <header className="sah-header">
        <div className="sah-header-title">
          <h1>Service Approval History</h1>
          <p>View all past service approval decisions and details</p>
        </div>
      </header>

      <div className="sah-content">
        <section className="sah-filter-section">
          <div className="sah-filter-header">
            <div className="sah-filter-title">Filter History</div>
          </div>

          <div className="sah-filter-controls">
            <div className="sah-filter-group sah-search-box">
              <label className="sah-filter-label">Search</label>
              <input
                type="text"
                className="sah-filter-input"
                placeholder="Job Card ID, Customer, Decision..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>

            <div className="sah-filter-group">
              <label className="sah-filter-label">Decision</label>
              <select
                className="sah-filter-select"
                value={decisionFilter}
                onChange={(e) => setDecisionFilter(e.target.value as any)}
              >
                <option value="">All</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div className="sah-filter-group">
              <label className="sah-filter-label">Date Range</label>
              <select
                className="sah-filter-select"
                value={dateRangeFilter}
                onChange={(e) => setDateRangeFilter(e.target.value as any)}
              >
                <option value="">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>

            <div className="sah-filter-actions">
              <button className="sah-btn sah-btn-secondary" onClick={clearHistoryFilters}>
                Clear
              </button>
            </div>
          </div>
        </section>

        <section className="sah-table-section">
          <div className="sah-table-header">
            <div className="sah-table-title">Request History</div>
            <div className="sah-table-info">
              {loading ? "Loading..." : <>Displaying <span>{filteredHistory.length}</span> requests</>}
            </div>
          </div>

          {!loading && filteredHistory.length === 0 ? (
            <div className="sah-empty-state">
              <div className="sah-empty-state-icon"><i className="fas fa-history"></i></div>
              <h3>No History Available</h3>
              <p>No request history found for the selected filters.</p>
            </div>
          ) : (
            <div className="sah-table-wrapper">
              <table className="sah-history-table">
                <thead>
                  <tr>
                    <th>Job Card ID</th>
                    <th>Customer</th>
                    <th>Plate</th>
                    <th>Request Date</th>
                    <th>Status</th>
                    <th>Decision By</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((h) => (
                    <tr key={h.requestId}>
                      <td>{h.id}</td>
                      <td>{h.customer}</td>
                      <td>{h.vehicle}</td>
                      <td>{h.requestDate}</td>
                      <td>
                        <span
                          className={`sah-status-badge ${
                            h.decision === "approved"
                              ? "sah-status-approved"
                              : h.decision === "declined"
                              ? "sah-status-declined"
                              : "sah-status-pending"
                          }`}
                        >
                          {h.decision === "approved" ? "Approved" : h.decision === "declined" ? "Declined" : "Pending"}
                        </span>
                      </td>
                      <td>{displayUser(h.decisionBy)}</td>
                      <td>{h.totalAdded}</td>
                      <td>
                        <PermissionGate moduleId="approvalhistory" optionId="approvalhistory_view">
                          <button className="sah-action-btn sah-view" onClick={() => viewHistoryDetails(h.id)}>
                            View Details
                          </button>
                        </PermissionGate>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ServiceApprovalHistory;