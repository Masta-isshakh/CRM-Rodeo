import { resolveOrderCreatedBy } from "../utils/actorIdentity";
import { normalizePaymentStatusLabel } from "../utils/paymentStatus";
import "./UnifiedJobOrderSummaryCard.css";

function getWorkStatusClass(status: any) {
  const normalized = String(status ?? "").trim();
  if (normalized === "Cancelled") return "status-cancelled";
  if (normalized === "Completed") return "status-completed";
  if (normalized === "Ready") return "status-ready";
  if (normalized === "New Request") return "status-new-request";
  return "status-in-progress";
}

function displayWorkStatusLabel(status: any) {
  const raw = String(status ?? "").trim();
  if (!raw) return "New Request";
  if (raw === "Service_Operation") return "Service Operation";
  return raw;
}

function getPaymentStatusClass(status: any) {
  const normalized = normalizePaymentStatusLabel(status);
  if (normalized === "Paid") return "status-paid";
  if (normalized === "Partial") return "status-partial";
  return "status-unpaid";
}

export function UnifiedJobOrderSummaryCard({
  order,
  identityToUsernameMap,
  className = "",
  createdByOverride,
  workStatusOverride,
  paymentStatusOverride,
}: {
  order: any;
  identityToUsernameMap?: Record<string, string>;
  className?: string;
  createdByOverride?: string;
  workStatusOverride?: string;
  paymentStatusOverride?: string;
}) {
  const summary = order?.jobOrderSummary || order?.summary || {};
  const delivery = order?.deliveryInfo || {};

  const serviceProgress = (() => {
    const services = Array.isArray(order?.services) ? order.services : [];
    const total = services.length;
    if (!total) return order?.serviceProgressInfo || {};

    const completed = services.filter((service: any) => {
      const status = String(service?.status ?? "").trim().toLowerCase();
      return status === "completed";
    }).length;

    const percent = Math.round((completed / Math.max(1, total)) * 100);
    return {
      ...(order?.serviceProgressInfo || {}),
      progress: {
        percent,
        label: `${completed}/${total} completed`,
      },
    };
  })();

  const createdBy =
    String(createdByOverride ?? "").trim() ||
    resolveOrderCreatedBy(order, {
      identityToUsernameMap,
      fallback: "—",
    }) ||
    "—";

  const workStatus = String(workStatusOverride ?? order?.workStatus ?? summary?.workStatus ?? "").trim();
  const paymentStatus = String(paymentStatusOverride ?? order?.paymentStatus ?? summary?.paymentStatus ?? "").trim();
  const createdOn = String(summary?.createDate ?? summary?.requestCreateDate ?? order?.createDate ?? "").trim();
  const expectedDelivery = String(
    summary?.expectedDelivery ?? summary?.expectedDeliveryDate ?? order?.jobOrderSummary?.expectedDelivery ?? ""
  ).trim();

  return (
    <div className={`epm-detail-card ujs-summary-card ${className}`.trim()}>
      <h3>
        <i className="fas fa-info-circle"></i> Job Order Summary
      </h3>
      <div className="epm-card-content jh-kv ujs-summary-content">
        <div className="epm-info-item">
          <span className="epm-info-label">Job Order ID</span>
          <span className="epm-info-value">{order?.id || "—"}</span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Order Type</span>
          <span className="epm-info-value">{order?.orderType || "Job Order"}</span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Work Status</span>
          <span className={`epm-status-badge status-badge ${getWorkStatusClass(workStatus)}`}>
            {displayWorkStatusLabel(workStatus)}
          </span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Payment Status</span>
          <span className={`epm-status-badge status-badge ${getPaymentStatusClass(paymentStatus)}`}>
            {normalizePaymentStatusLabel(paymentStatus)}
          </span>
        </div>

        {serviceProgress?.progress && (
          <div className="epm-info-item ujs-item-span-2">
            <span className="epm-info-label">Service Progress</span>
            <div className="ujs-progress-row">
              <div className="ujs-progress-track">
                <div className="epm-progress-bar">
                  <div className="epm-progress-fill" style={{ width: `${serviceProgress.progress.percent}%` }}></div>
                </div>
              </div>
              <span className="epm-progress-text">{serviceProgress.progress.label}</span>
            </div>
          </div>
        )}

        {createdOn && (
          <div className="epm-info-item">
            <span className="epm-info-label">Created On</span>
            <span className="epm-info-value">{createdOn}</span>
          </div>
        )}

        <div className="epm-info-item">
          <span className="epm-info-label">Created By</span>
          <span className="epm-info-value">{createdBy}</span>
        </div>

        {expectedDelivery && (
          <div className="epm-info-item">
            <span className="epm-info-label">Expected Delivery</span>
            <span className="epm-info-value">{expectedDelivery}</span>
          </div>
        )}

        {(delivery?.estimatedHours || delivery?.actualHours) && (
          <div className="epm-info-item">
            <span className="epm-info-label">Time Estimate</span>
            <span className="epm-info-value">
              Est: {delivery.estimatedHours || "N/A"} {delivery.actualHours && `| Actual: ${delivery.actualHours}`}
            </span>
          </div>
        )}

        {order?.customerNotes && (
          <div className="epm-info-item ujs-item-span-3 ujs-notes-item">
            <span className="epm-info-label">Customer Notes</span>
            <span className="epm-info-value ujs-notes-value">
              {order.customerNotes}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
