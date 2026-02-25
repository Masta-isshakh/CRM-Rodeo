// src/pages/JobOrderManagement.tsx
// ✅ Full updated file - paste as-is

import { useEffect,  useState } from "react";
import { createPortal } from "react-dom";
import "./JobCards.css";
import { getUrl } from "aws-amplify/storage";

import SuccessPopup from "./SuccessPopup";
import ErrorPopup from "./ErrorPopup";
import PermissionGate from "./PermissionGate";

import {
  listJobOrdersForMain,
  getJobOrderByOrderNumber,
  upsertJobOrder,
  cancelJobOrderByOrderNumber,
  searchCustomers,
  getCustomerWithVehicles,
  createCustomer,
  createVehicleForCustomer,
  listCompletedOrdersByPlateNumber,
} from "./jobOrderRepo";

// ============================================
// DEMO DATA (catalog only — keep)
// ============================================
const YOUR_PRODUCTS = [
  { name: "Extra Cool Tint", suvPrice: 3200, sedanPrice: 2900 },
  { name: "UV Protection Film", suvPrice: 2500, sedanPrice: 2200 },
  { name: "Cool Shade Tint", suvPrice: 1800, sedanPrice: 1500 },
  { name: "Smart Pro Protection", suvPrice: 17500, sedanPrice: 15500 },
  { name: "Full Body Protection", suvPrice: 5500, sedanPrice: 4400 },
  { name: "Quarter Panel Protection", suvPrice: 4300, sedanPrice: 3500 },
  { name: "Glass Protection (Light)", suvPrice: 400, sedanPrice: 400 },
  { name: "Extreme Glass Protection", suvPrice: 1200, sedanPrice: 1200 },
  { name: "City Glass Protection", suvPrice: 800, sedanPrice: 800 },
  { name: "Matte Protection", suvPrice: 18500, sedanPrice: 16500 },
  { name: "Color Change", suvPrice: 20500, sedanPrice: 18500 },
  { name: "Leather Protection", suvPrice: 1200, sedanPrice: 1200 },
  { name: "Wheel Protection", suvPrice: 600, sedanPrice: 600 },
  { name: "VIP Interior & Exterior Polish", suvPrice: 1650, sedanPrice: 1650 },
  { name: "Interior Polish", suvPrice: 850, sedanPrice: 850 },
  { name: "Exterior Polish", suvPrice: 800, sedanPrice: 800 },
  { name: "Nano Interior & Exterior Polish", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Rear Bumper Protection", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Fender Protection", suvPrice: 2000, sedanPrice: 2000 },
  { name: "Roof Protection", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Single Door Protection", suvPrice: 400, sedanPrice: 400 },
  { name: "Front Bumper Protection", suvPrice: 1500, sedanPrice: 1500 },
  { name: "Mirror Protection (Each)", suvPrice: 150, sedanPrice: 150 },
  { name: "Front Fender Protection (Each)", suvPrice: 500, sedanPrice: 500 },
  { name: "Rear Fender for Pickups & Small Cars", suvPrice: 1700, sedanPrice: 1700 },
  { name: "Rear Fender Protection (Each)", suvPrice: 2800, sedanPrice: 2800 },
  { name: "Headlight Protection (Each)", suvPrice: 150, sedanPrice: 150 },
  { name: "Trunk Door Protection", suvPrice: 1000, sedanPrice: 1000 },
  { name: "Tire Base Protection (Each)", suvPrice: 400, sedanPrice: 400 },
  { name: "Pedal Protection (Each)", suvPrice: 400, sedanPrice: 400 },
];

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";

  // ✅ Your storage resource uses "job-orders/*"
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }

  // already a full URL (or something else)
  return v;
}


function joStr(v: any) {
  return String(v ?? "").trim();
}

function joFirst(...vals: any[]) {
  for (const v of vals) {
    const s = joStr(v);
    if (s) return s;
  }
  return "";
}

function joIsPlaceholderName(s: string) {
  const t = joStr(s).toLowerCase();
  return (
    !t ||
    t === "system user" ||
    t === "system" ||
    t === "n/a" ||
    t === "na" ||
    t === "not assigned" ||
    t === "unknown"
  );
}

/** ✅ Best creator name for the order (handles different payload shapes) */
function resolveCreatedBy(order: any) {
  const summary = order?.jobOrderSummary ?? {};

  // Prefer explicit creator fields
  const primary = joFirst(
    summary.createdByName,
    summary.createdBy,
    summary.createBy,
    summary.createdByUser,
    summary.createdByUserName,
    order?.createdByName,
    order?.createdBy,
    order?.createdByUserName
  );

  // If primary is placeholder (e.g., "System User"), try better alternatives
  if (joIsPlaceholderName(primary)) {
    const alt = joFirst(
      order?.jobOrderSummary?.actionByName,
      order?.jobOrderSummary?.actionBy,
      order?.createdByDisplay,
      order?.createdByEmail
    );
    return alt && !joIsPlaceholderName(alt) ? alt : (primary || "—");
  }

  return primary || "—";
}

/** ✅ Roadmap actor should represent who performed the step (NOT assignment) */
function resolveRoadmapActor(step: any, order: any) {
  const actor = joFirst(
    // ✅ action performer fields first
    step?.actionByName,
    step?.actionBy,
    step?.performedBy,
    step?.doneBy,
    step?.updatedByName,
    step?.updatedBy,

    // ✅ only then allow technician fields (some steps may use it as performer)
    step?.technicianName,
    step?.technician,

    // ✅ New Request fallback to createdBy
    step?.step === "New Request" ? resolveCreatedBy(order) : ""
  );

  return actor || "Not assigned";
}

/** ✅ Cashier name resolver (never use paymentMethod as fallback) */
function resolveCashierName(payment: any) {
  const cashier = joFirst(
    payment?.cashierName,
    payment?.cashier,
    payment?.cashierUserName,
    payment?.cashierUsername,
    payment?.createdByName,
    payment?.createdBy,
    payment?.performedBy,
    payment?.doneBy,
    payment?.userName,
    payment?.user,
    payment?.staffName,
    payment?.employeeName
  );

  return cashier || "—";
}

// ============================================
// MAIN COMPONENT
// ============================================
function JobOrderManagement({ currentUser, navigationData, onClearNavigation, onNavigateBack }: any) {
  const [screenState, setScreenState] = useState<"main" | "details" | "newJob" | "addService">("main");
  const [currentDetailsOrder, setCurrentDetailsOrder] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [demoOrders, setDemoOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [currentAddServiceOrder, setCurrentAddServiceOrder] = useState<any>(null);

  const [inspectionModalOpen, setInspectionModalOpen] = useState(false);
  const [currentInspectionItem, setCurrentInspectionItem] = useState<any>(null);

  // ✅ Success popup state
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState("");
  const [lastAction, setLastAction] = useState<"create" | "cancel" | "addService">("create");
  const [showAddServiceSuccessPopup, setShowAddServiceSuccessPopup] = useState(false);
  const [addServiceSuccessData, setAddServiceSuccessData] = useState({ orderId: "", invoiceId: "" });

  // ✅ Error popup state
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorTitle, setErrorTitle] = useState("Operation failed");
  const [errorMessage, setErrorMessage] = useState<React.ReactNode>(null);
  const [errorDetails, setErrorDetails] = useState<string | undefined>(undefined);
  const [errorRetry, setErrorRetry] = useState<(() => void) | undefined>(undefined);

  const showError = (args: {
    title?: string;
    message: React.ReactNode;
    details?: string;
    onRetry?: () => void;
  }) => {
    setErrorTitle(args.title || "Operation failed");
    setErrorMessage(args.message);
    setErrorDetails(args.details);
    setErrorRetry(args.onRetry);
    setErrorOpen(true);
  };

  const [newJobPrefill, setNewJobPrefill] = useState<any>(null);
  const [navigationSource, setNavigationSource] = useState<any>(null);
  const [returnToVehicleId, setReturnToVehicleId] = useState<any>(null);

  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  

  async function refreshMainOrders() {
    setLoadingOrders(true);
    try {
      const orders = await listJobOrdersForMain();
      setDemoOrders(orders);
    } finally {
      setLoadingOrders(false);
    }
  }

  useEffect(() => {
    void refreshMainOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screenState === "main") void refreshMainOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState]);

  useEffect(() => setCurrentPage(1), [searchQuery]);
  useEffect(() => setCurrentPage(1), [pageSize]);

  useEffect(() => {
    if (navigationData?.openNewJob) {
      setNewJobPrefill({
        startStep: navigationData.startStep || 1,
        customerData: navigationData.customerData || null,
        vehicleData: navigationData.vehicleData || null,
      });
      if (navigationData.source) setNavigationSource(navigationData.source);
      if (navigationData.returnToVehicle) setReturnToVehicleId(navigationData.returnToVehicle);

      setScreenState("newJob");

      const timer = setTimeout(() => {
        if (onClearNavigation) onClearNavigation();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [navigationData, onClearNavigation]);

  const parseAmount = (value: any) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.-]/g, "");
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const formatAmount = (value: any) => `QAR ${Number(value || 0).toLocaleString()}`;

  // ✅ Add service submit with ErrorPopup + SuccessPopup
  const handleAddServiceSubmit = async ({ selectedServices, discountPercent }: any) => {
    if (!currentAddServiceOrder || !selectedServices || selectedServices.length === 0) {
      setScreenState("details");
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const invoiceNumber = `INV-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const billId =
      currentAddServiceOrder.billing?.billId ||
      `BILL-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    const subtotal = selectedServices.reduce((sum: number, s: any) => sum + (s.price || 0), 0);
    const discount = (subtotal * (discountPercent || 0)) / 100;
    const netAmount = subtotal - discount;

    const existingTotal = parseAmount(currentAddServiceOrder.billing?.totalAmount);
    const existingDiscount = parseAmount(currentAddServiceOrder.billing?.discount);
    const existingNet = parseAmount(currentAddServiceOrder.billing?.netAmount);
    const existingPaid = parseAmount(currentAddServiceOrder.billing?.amountPaid);

    const updatedBilling = {
      billId,
      totalAmount: formatAmount(existingTotal + subtotal),
      discount: formatAmount(existingDiscount + discount),
      netAmount: formatAmount(existingNet + netAmount),
      amountPaid: formatAmount(existingPaid),
      balanceDue: formatAmount(existingNet + netAmount - existingPaid),
      paymentMethod: currentAddServiceOrder.billing?.paymentMethod || null,
      invoices: [
        ...(currentAddServiceOrder.billing?.invoices || []),
        {
          number: invoiceNumber,
          amount: formatAmount(netAmount),
          discount: formatAmount(discount),
          status: "Unpaid",
          paymentMethod: null,
          services: selectedServices.map((s: any) => s.name),
        },
      ],
    };

    const newServiceEntries = selectedServices.map((service: any) => ({
      name: service.name,
      price: service.price || 0,
      status: "New",
      started: "Not started",
      ended: "Not completed",
      duration: "Not started",
      technician: "Not assigned",
      notes: "Added from Job Order details",
    }));

    const updatedOrder = {
      ...currentAddServiceOrder,
      services: [...(currentAddServiceOrder.services || []), ...newServiceEntries],
      billing: updatedBilling,
    };

    try {
      setLoadingOrders(true);

      const { backendId } = await upsertJobOrder(updatedOrder);
      updatedOrder._backendId = backendId;

      await refreshMainOrders();

      setCurrentDetailsOrder(updatedOrder);
      setCurrentAddServiceOrder(updatedOrder);

      setAddServiceSuccessData({ orderId: currentAddServiceOrder.id, invoiceId: invoiceNumber });
      setShowAddServiceSuccessPopup(true);
      setLastAction("addService");

      setTimeout(() => setScreenState("details"), 50);
    } catch (e) {
      console.error(e);
      showError({
        title: "Add services failed",
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Could not add services to this job order.</div>
            <div>{errMsg(e)}</div>
          </div>
        ),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void handleAddServiceSubmit({ selectedServices, discountPercent }),
      });
      setScreenState("details");
    } finally {
      setLoadingOrders(false);
    }
  };

  // ✅ Cancel: uses ErrorPopup + refresh
  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;

    const orderToCancel = demoOrders.find((o) => o.id === cancelOrderId);
    if (!orderToCancel) {
      showError({
        title: "Cancel failed",
        message: "Order not found in the current list. Please refresh and try again.",
        onRetry: () => void refreshMainOrders(),
      });
      return;
    }

    if (orderToCancel.workStatus === "Cancelled") {
      showError({
        title: "Already cancelled",
        message: `Job Order ${cancelOrderId} is already cancelled.`,
      });
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
      return;
    }

    try {
      setLoadingOrders(true);

      await cancelJobOrderByOrderNumber(cancelOrderId);
      await refreshMainOrders();

      setSubmittedOrderId(cancelOrderId);
      setLastAction("cancel");
      setShowSuccessPopup(true);
    } catch (e) {
      console.error(e);
      showError({
        title: "Cancel failed",
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Could not cancel this job order.</div>
            <div>{errMsg(e)}</div>
          </div>
        ),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void handleCancelOrder(),
      });
    } finally {
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
      setLoadingOrders(false);
    }
  };

  const filteredOrders = demoOrders.filter((order) => {
    const allowedStatuses = ["New Request", "Inspection", "Inprogress", "Quality Check", "Ready"];
    if (!allowedStatuses.includes(order.workStatus)) return false;

    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      String(order.id || "").toLowerCase().includes(query) ||
      String(order.customerName || "").toLowerCase().includes(query) ||
      String(order.mobile || "").toLowerCase().includes(query) ||
      String(order.vehiclePlate || "").toLowerCase().includes(query) ||
      String(order.workStatus || "").toLowerCase().includes(query)
    );
  });

  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="job-order-management">
      {screenState === "main" && (
        <MainScreen
          orders={paginatedOrders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onViewDetails={async (order: any) => {
            try {
              const fresh = await getJobOrderByOrderNumber(order.id);
              setCurrentDetailsOrder(fresh || order);
              setScreenState("details");
            } catch (e) {
              console.error(e);
              showError({
                title: "Load details failed",
                message: errMsg(e),
                details: String((e as any)?.stack ?? ""),
                onRetry: async () => {
                  const fresh = await getJobOrderByOrderNumber(order.id);
                  setCurrentDetailsOrder(fresh || order);
                  setScreenState("details");
                },
              });
            }
          }}
          onNewJob={() => setScreenState("newJob")}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          totalCount={filteredOrders.length}
          onCancelOrder={(orderId: string) => {
            setCancelOrderId(orderId);
            setShowCancelConfirmation(true);
          }}
          loading={loadingOrders}
        />
      )}

      {screenState === "details" && currentDetailsOrder && (
        <DetailsScreen
          order={currentDetailsOrder}
          onClose={() => setScreenState("main")}
          onAddService={() => {
            setCurrentAddServiceOrder(currentDetailsOrder);
            setScreenState("addService");
          }}
        />
      )}

      {screenState === "newJob" && (
        <NewJobScreen
          currentUser={currentUser}
          onClose={() => {
            setScreenState("main");
            setNewJobPrefill(null);
            if (navigationSource && onNavigateBack) {
              const vehicleId = returnToVehicleId;
              setNavigationSource(null);
              setReturnToVehicleId(null);
              onNavigateBack(navigationSource, vehicleId);
            }
          }}
          prefill={newJobPrefill}
          onSubmit={async (newOrder: any) => {
            setLoadingOrders(true);

            const doCreate = async () => {
              const out = await upsertJobOrder(newOrder);
              newOrder._backendId = out?.backendId;

              await refreshMainOrders();

              setScreenState("main");
              setSubmittedOrderId(String(newOrder.id || ""));
              setLastAction("create");
              setShowSuccessPopup(true);

              setNewJobPrefill(null);
              setNavigationSource(null);
              setReturnToVehicleId(null);

              window.scrollTo({ top: 0, behavior: "smooth" });
            };

            try {
              await doCreate();
            } catch (e) {
              console.error(e);
              showError({
                title: "Create job order failed",
                message: (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Your job order was not created.</div>
                    <div>{errMsg(e)}</div>
                  </div>
                ),
                details: String((e as any)?.stack ?? ""),
                onRetry: () => void doCreate(),
              });
            } finally {
              setLoadingOrders(false);
            }
          }}
        />
      )}

      {screenState === "addService" && currentAddServiceOrder && (
        <AddServiceScreen order={currentAddServiceOrder} onClose={() => setScreenState("details")} onSubmit={handleAddServiceSubmit} />
      )}

      {inspectionModalOpen && currentInspectionItem && (
        <InspectionModal
          item={currentInspectionItem}
          onClose={() => {
            setInspectionModalOpen(false);
            setCurrentInspectionItem(null);
          }}
        />
      )}

      {/* ✅ Success Popup: Create / Cancel */}
      {showSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => {
            setShowSuccessPopup(false);
            setLastAction("create");
          }}
          title={lastAction === "cancel" ? "Cancelled" : "Created"}
          message={
            lastAction === "cancel" ? (
              <>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                  <i className="fas fa-check-circle"></i> Order Cancelled Successfully!
                </span>
                <span style={{ fontSize: "1.1rem", color: "#333", display: "block", marginTop: "10px" }}>
                  <strong>Job Order ID:</strong>{" "}
                  <span style={{ color: "#2196F3", fontWeight: "600" }}>{submittedOrderId}</span>
                </span>
                <span style={{ fontSize: "0.95rem", color: "#666", display: "block", marginTop: "8px" }}>
                  This order is now marked as Cancelled.
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                  <i className="fas fa-check-circle"></i> Order Created Successfully!
                </span>
                <span style={{ fontSize: "1.1rem", color: "#333", display: "block", marginTop: "10px" }}>
                  <strong>Job Order ID:</strong>{" "}
                  <span style={{ color: "#2196F3", fontWeight: "600" }}>{submittedOrderId}</span>
                </span>
              </>
            )
          }
          autoCloseMs={2200}
        />
      )}

      {/* ✅ Add Service Success Popup */}
      {showAddServiceSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => setShowAddServiceSuccessPopup(false)}
          title="Services added"
          message={
            <>
              <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                <i className="fas fa-check-circle"></i> Services Added Successfully!
              </span>
              <span style={{ fontSize: "1.05rem", color: "#333", display: "block", marginTop: "10px" }}>
                <strong>Job Order ID:</strong>{" "}
                <span style={{ color: "#2196F3", fontWeight: "600" }}>{addServiceSuccessData.orderId}</span>
              </span>
              <span style={{ fontSize: "1.05rem", color: "#333", display: "block", marginTop: "8px" }}>
                <strong>New Invoice ID:</strong>{" "}
                <span style={{ color: "#27ae60", fontWeight: "600" }}>{addServiceSuccessData.invoiceId}</span>
              </span>
            </>
          }
          autoCloseMs={2200}
        />
      )}

      {/* ✅ Error Popup */}
      <ErrorPopup
        isVisible={errorOpen}
        onClose={() => setErrorOpen(false)}
        title={errorTitle}
        message={errorMessage || "Unknown error"}
        details={errorDetails}
        onRetry={errorRetry}
      />

      {/* Cancel Confirmation Modal */}
      <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3>
              <i className="fas fa-exclamation-triangle"></i> Confirm Cancellation
            </h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text">
                <p>
                  You are about to cancel order <strong>{cancelOrderId}</strong>.
                </p>
                <p>This action cannot be undone.</p>
              </div>
            </div>
            <div className="cancel-modal-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setShowCancelConfirmation(false);
                  setCancelOrderId(null);
                }}
              >
                <i className="fas fa-times"></i> Keep Order
              </button>
              <button className="btn-confirm-cancel" onClick={handleCancelOrder} disabled={loadingOrders}>
                <i className="fas fa-ban"></i> {loadingOrders ? "Cancelling..." : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN SCREEN
// ============================================
function MainScreen({
  orders,
  searchQuery,
  onSearchChange,
  onViewDetails,
  onNewJob,
  currentPage,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalCount,
  onCancelOrder,
  loading,
}: any) {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  useEffect(() => {
    const handleClickOutside = (event: any) => {
      const isDropdownButton = event.target.closest(".btn-action-dropdown");
      const isDropdownMenu = event.target.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
    };

    if (activeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [activeDropdown]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-tools"></i> Job Order Management
          </h1>
        </div>
      </header>

      <main className="main-content">
        <section className="search-section">
          <div className="search-container">
            <i className="fas fa-search search-icon"></i>
            <input
              type="text"
              className="smart-search-input"
              placeholder="Search by any details"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="search-stats">
            {loading ? "Loading..." : totalCount === 0 ? "No job orders found" : `Showing ${orders.length} of ${totalCount} job orders`}
          </div>
        </section>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-list"></i> Job Order Records
            </h2>
            <div className="pagination-controls">
              <div className="records-per-page">
                <label htmlFor="pageSizeSelect">Records per page:</label>
                <select id="pageSizeSelect" className="page-size-select" value={pageSize} onChange={(e) => onPageSizeChange(parseInt(e.target.value))}>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <PermissionGate moduleId="joborder" optionId="joborder_add">
                <button className="btn-new-job" onClick={onNewJob}>
                  <i className="fas fa-plus-circle"></i> New Job Order
                </button>
              </PermissionGate>
            </div>
          </div>

          {orders.length > 0 ? (
            <div className="table-wrapper">
              <table className="job-order-table">
                <thead>
                  <tr>
                    <th>Create Date</th>
                    <th>Job Card ID</th>
                    <th>Order Type</th>
                    <th>Customer Name</th>
                    <th>Mobile Number</th>
                    <th>Vehicle Plate</th>
                    <th>Work Status</th>
                    <th>Payment Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order: any) => (
                    <tr key={order.id}>
                      <td className="date-column">{order.createDate}</td>
                      <td>{order.id}</td>
                      <td>
                        <span className={`order-type-badge ${order.orderType === "New Job Order" ? "order-type-new-job" : "order-type-service"}`}>
                          {order.orderType}
                        </span>
                      </td>
                      <td>{order.customerName}</td>
                      <td>{order.mobile}</td>
                      <td>{order.vehiclePlate}</td>
                      <td>
                        <span className={`status-badge ${getWorkStatusClass(order.workStatus)}`}>{order.workStatus}</span>
                      </td>
                      <td>
                        <span className={`status-badge ${getPaymentStatusClass(order.paymentStatus)}`}>{order.paymentStatus}</span>
                      </td>
                      <td>
                        <PermissionGate moduleId="joborder" optionId="joborder_actions">
                          <div className="action-dropdown-container">
                            <button
                              className={`btn-action-dropdown ${activeDropdown === order.id ? "active" : ""}`}
                              onClick={(e: any) => {
                                const isActive = activeDropdown === order.id;
                                if (isActive) {
                                  setActiveDropdown(null);
                                  return;
                                }
                                const rect = e.currentTarget.getBoundingClientRect();
                                const menuHeight = 140;
                                const menuWidth = 200;
                                const spaceBelow = window.innerHeight - rect.bottom;
                                const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                                const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                                setDropdownPosition({ top, left });
                                setActiveDropdown(order.id);
                              }}
                            >
                              <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                            </button>
                          </div>
                        </PermissionGate>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <i className="fas fa-search"></i>
              </div>
              <div className="empty-text">No matching job orders found</div>
              <div className="empty-subtext">Try adjusting your search terms or click "New Job Order" to create one</div>
            </div>
          )}
        </section>

        {orders.length > 0 && totalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
              <i className="fas fa-chevron-left"></i>
            </button>
            <div className="page-numbers">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) pageNum = i + 1;
                else {
                  const start = Math.max(1, currentPage - 2);
                  const end = Math.min(totalPages, start + 4);
                  const adjustedStart = Math.max(1, end - 4);
                  pageNum = adjustedStart + i;
                }
                return (
                  <button key={pageNum} className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`} onClick={() => onPageChange(pageNum)}>
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button className="pagination-btn" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Service Management System © 2023 | Job Order Management Module</p>
      </footer>

      {activeDropdown &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="action-dropdown-menu show action-dropdown-menu-fixed" style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}>
            <PermissionGate moduleId="joborder" optionId="joborder_viewdetails">
              <button
                className="dropdown-item view"
                onClick={() => {
                  onViewDetails(orders.find((o: any) => o.id === activeDropdown));
                  setActiveDropdown(null);
                }}
              >
                <i className="fas fa-eye"></i> View Details
              </button>
            </PermissionGate>

            <PermissionGate moduleId="joborder" optionId="joborder_cancel">
              <>
                <div className="dropdown-divider"></div>
                <button
                  className="dropdown-item delete"
                  onClick={() => {
                    onCancelOrder(activeDropdown);
                    setActiveDropdown(null);
                  }}
                >
                  <i className="fas fa-times-circle"></i> Cancel Order
                </button>
              </>
            </PermissionGate>
          </div>,
          document.body
        )}
    </div>
  );
}

// ============================================
// DETAILS SCREEN
// ============================================
function DetailsScreen({ order, onClose, onAddService }: any) {
  return (
<div className="pim-details-screen jo-details-v3">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-clipboard-list"></i> Job Order Details - {order.id}
          </h2>
          {/* ✅ NEW: Header Status Indicators */}
          <div className="pim-details-header-badges">
            {order.priorityLevel && (
              <span 
                className="pim-priority-badge" 
                style={{ 
                  backgroundColor: order.priorityBg, 
                  color: order.priorityColor,
                  borderLeft: `3px solid ${order.priorityColor}`
                }}
              >
                <i className="fas fa-exclamation-circle"></i> {order.priorityLevel}
              </span>
            )}
            {order.qualityCheck && (
              <span className={`pim-qc-badge ${order.qualityCheck.status.toLowerCase()}`}>
                <i className={order.qualityCheck.status === 'PASSED' ? 'fas fa-check-circle' : order.qualityCheck.status === 'FAILED' ? 'fas fa-times-circle' : 'fas fa-hourglass-half'}></i>
                {order.qualityCheck.displayText}
              </span>
            )}
            {order.exitPermitInfo && (
              <span className={`pim-permit-badge ${order.exitPermitInfo.required ? 'required' : 'not-required'}`}>
                <i className={order.exitPermitInfo.status === 'APPROVED' ? 'fas fa-certificate' : 'fas fa-file'}></i>
                Exit Permit: {order.exitPermitInfo.status}
              </span>
            )}
            {order.technicianAssignment && order.technicianAssignment.name && (
              <span className="pim-tech-badge">
                <i className="fas fa-user-tie"></i> {order.technicianAssignment.displayText}
              </span>
            )}
          </div>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> Close Details
        </button>
      </div>

      <div className="pim-details-body">
        <div className="pim-details-grid">
          <PermissionGate moduleId="joborder" optionId="joborder_summary">
            <JobOrderSummaryCard order={order} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_customer">
            <CustomerDetailsCard order={order} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_vehicle">
            <VehicleDetailsCard order={order} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_services">
            <ServicesCard order={order} onAddService={onAddService} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_billing">
            <BillingCard order={order} />
          </PermissionGate>
          
          {/* ✅ NEW: Quality Check Card */}
          {order.qualityCheck && (
            <PermissionGate moduleId="joborder" optionId="joborder_quality">
              <QualityCheckCard order={order} />
            </PermissionGate>
          )}
          
          {/* ✅ NEW: Delivery Tracking Card */}
          {order.deliveryInfo && (
            <PermissionGate moduleId="joborder" optionId="joborder_delivery">
              <DeliveryTrackingCard order={order} />
            </PermissionGate>
          )}
          
          <PermissionGate moduleId="joborder" optionId="joborder_paymentlog">
            <PaymentActivityLogCard order={order} />
          </PermissionGate>
        </div>

        {/* Roadmap Timeline - Full Width */}
        <PermissionGate moduleId="joborder" optionId="joborder_roadmap">
          <RoadmapCard order={order} />
        </PermissionGate>

        {/* ✅ Documents (Billing docs if available) - Full Width at bottom */}
<PermissionGate moduleId="joborder" optionId="joborder_documents">
  <JobOrderDocumentsCard order={order} />
</PermissionGate>
      </div>
    </div>
  );
}

// ============================================
// NEW JOB SCREEN (unchanged UI)
// ============================================
function NewJobScreen({ currentUser, onClose, onSubmit, prefill }: any) {
  const [step, setStep] = useState(1);
  const [orderType, setOrderType] = useState<any>(null); // 'new' or 'service'
  const [customerType, setCustomerType] = useState<any>(null);
  const [customerData, setCustomerData] = useState<any>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);

  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [additionalServices, setAdditionalServices] = useState<any[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [orderNotes, setOrderNotes] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [expectedDeliveryTime, setExpectedDeliveryTime] = useState("");
  const [vehicleCompletedServices, setVehicleCompletedServices] = useState<any[]>([]);

  const formatAmount = (value: any) => `QAR ${Number(value || 0).toLocaleString()}`;

  const handleVehicleSelected = async (vehicleInfo: any) => {
    setVehicleData(vehicleInfo);

    const plate = vehicleInfo.plateNumber || vehicleInfo.license || "";
    const completed = plate ? await listCompletedOrdersByPlateNumber(plate) : [];
    setVehicleCompletedServices(completed);

    if (orderType === "service" && completed.length === 0) {
      setOrderType("new");
    }
  };

  useEffect(() => {
    if (!prefill) return;

    if (prefill.customerData) {
      setCustomerType("existing");
      setCustomerData(prefill.customerData);
    }

    if (prefill.vehicleData) {
      void handleVehicleSelected(prefill.vehicleData);
    }

    if (prefill.startStep) setStep(Math.max(1, prefill.startStep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const handleSubmit = () => {
    const now = new Date();
    const year = now.getFullYear();
    const jobOrderId = `JO-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    const servicesToBill = orderType === "service" ? additionalServices : selectedServices;
    const subtotal = servicesToBill.reduce((sum: number, s: any) => sum + (s.price || 0), 0);
    const discount = (subtotal * (discountPercent || 0)) / 100;
    const netAmount = subtotal - discount;

    const billId = `BILL-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const invoiceNumber = `INV-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    const newOrder = {
      id: jobOrderId,
      orderType: orderType === "service" ? "Service Order" : "New Job Order",
      customerName: customerData.name,
      mobile: customerData.mobile || customerData.phone,
      vehiclePlate: vehicleData.plateNumber || vehicleData.license,
      workStatus: "New Request",
      paymentStatus: "Unpaid",
      createDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      jobOrderSummary: {
        createDate: new Date().toLocaleString(),
        createdBy: currentUser?.name || "System User",
        expectedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleString(),
      },
      customerDetails: {
        customerId: customerData.id,
        email: customerData.email,
        address: customerData.address || null,
        registeredVehicles: `${customerData.vehicles?.length ?? customerData.registeredVehiclesCount ?? 1} vehicles`,
        registeredVehiclesCount: customerData.vehicles?.length ?? customerData.registeredVehiclesCount ?? 1,
        completedServicesCount: customerData.completedServicesCount ?? 0,
        customerSince: customerData.customerSince || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      },
      vehicleDetails: {
        vehicleId: vehicleData.vehicleId || "VEH-" + Math.floor(Math.random() * 10000),
        ownedBy: customerData.name,
        make: vehicleData.make || vehicleData.factory,
        model: vehicleData.model,
        year: vehicleData.year,
        type: vehicleData.vehicleType || vehicleData.carType,
        color: vehicleData.color,
        plateNumber: vehicleData.plateNumber || vehicleData.license,
        vin: vehicleData.vin || "N/A",
        registrationDate: vehicleData.registrationDate || "N/A",
      },
      services:
        orderType === "service"
          ? additionalServices.map((s: any) => ({
              name: s.name,
              price: s.price || 0,
              status: "New",
              started: "Not started",
              ended: "Not completed",
              duration: "Not started",
              technician: "Not assigned",
              notes: "Additional service for completed order",
            }))
          : selectedServices.map((s: any) => ({
              name: s.name,
              price: s.price || 0,
              status: "New",
              started: "Not started",
              ended: "Not completed",
              duration: "Not started",
              technician: "Not assigned",
              notes: "New service request",
            })),
      billing: {
        billId,
        totalAmount: formatAmount(subtotal),
        discount: formatAmount(discount),
        netAmount: formatAmount(netAmount),
        amountPaid: formatAmount(0),
        balanceDue: formatAmount(netAmount),
        paymentMethod: null,
        invoices: [
          {
            number: invoiceNumber,
            amount: formatAmount(netAmount),
            discount: formatAmount(discount),
            status: "Unpaid",
            paymentMethod: null,
            services: servicesToBill.map((s: any) => s.name),
          },
        ],
      },
      roadmap: [
        {
          step: "New Request",
          stepStatus: "Active",
          startTimestamp: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
          endTimestamp: null,
          actionBy: currentUser?.name || "System User",
          status: "InProgress",
        },
        { step: "Inspection", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Inprogress", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Quality Check", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Ready", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
      ],
      inspectionResult: null,
      deliveryQualityCheck: null,
      exitPermit: null,
      additionalServiceRequests: [],
      documents: [],
      customerNotes: orderNotes || null,

      discountPercent,
      expectedDeliveryDate,
      expectedDeliveryTime,
    };

    onSubmit(newOrder);
  };

return (
  <div className="pim-details-screen jo-wizard-screen">
    <div className="pim-details-header jo-wizard-header">
      <div className="pim-details-title-container">
        <h2>
          <i className="fas fa-plus-circle"></i> Create New Job Order
        </h2>
      </div>
      <button className="pim-btn-close-details jo-wizard-cancel-btn" onClick={onClose}>
        <i className="fas fa-times"></i> Cancel
      </button>
    </div>

    <div className="pim-details-body jo-wizard-body">
      <div className="progress-bar jo-wizard-stepper">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className={`progress-step ${s < step ? "completed" : s === step ? "active" : ""}`}>
            <span>{s}</span>
            <div className="step-label">{["Customer", "Vehicle", "Order Type", "Services", "Confirm"][s - 1]}</div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <StepOneCustomer
          customerType={customerType}
          setCustomerType={setCustomerType}
          customerData={customerData}
          setCustomerData={setCustomerData}
          onNext={() => setStep(2)}
          onCancel={onClose}
        />
      )}

      {step === 2 && (
        <StepTwoVehicle
          vehicleData={vehicleData}
          setVehicleData={setVehicleData}
          customerData={customerData}
          setCustomerData={setCustomerData}
          onVehicleSelected={handleVehicleSelected}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && vehicleCompletedServices.length > 0 && (
        <OrderTypeSelection
          vehicleCompletedServices={vehicleCompletedServices}
          orderType={orderType}
          onSelectOrderType={(type: any) => {
            setOrderType(type);
            setStep(4);
          }}
          onBack={() => setStep(2)}
        />
      )}

      {step === 3 && vehicleCompletedServices.length === 0 && (
        <NoCompletedServicesMessage
          onNext={() => {
            setOrderType("new");
            setStep(4);
          }}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <StepThreeServices
          selectedServices={orderType === "service" ? additionalServices : selectedServices}
          setSelectedServices={orderType === "service" ? setAdditionalServices : setSelectedServices}
          vehicleType={vehicleData?.carType || vehicleData?.vehicleType || "SUV"}
          discountPercent={discountPercent}
          setDiscountPercent={setDiscountPercent}
          orderNotes={orderNotes}
          setOrderNotes={setOrderNotes}
          expectedDeliveryDate={expectedDeliveryDate}
          setExpectedDeliveryDate={setExpectedDeliveryDate}
          expectedDeliveryTime={expectedDeliveryTime}
          setExpectedDeliveryTime={setExpectedDeliveryTime}
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}

      {step === 5 && (
        <StepFourConfirm
          orderType={orderType}
          customerData={customerData}
          vehicleData={vehicleData}
          selectedServices={orderType === "service" ? additionalServices : selectedServices}
          discountPercent={discountPercent}
          orderNotes={orderNotes}
          expectedDeliveryDate={expectedDeliveryDate}
          expectedDeliveryTime={expectedDeliveryTime}
          onBack={() => setStep(4)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  </div>
);
}

// ======================================================================
// ✅ IMPORTANT
// Keep the rest of your components exactly as in your current file:
// StepOneCustomer, StepTwoVehicle, StepThreeServices, AddServiceScreen,
// InspectionModal, StepFourConfirm, cards, utility functions, export.
// ======================================================================

// ============================================
// CUSTOMER STEP (backend search/create)
// ============================================
function StepOneCustomer({ customerType, setCustomerType, customerData, setCustomerData, onNext, onCancel }: any) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const [smartSearch, setSmartSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  const [verifiedCustomer, setVerifiedCustomer] = useState<any>(null);

  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCustomerData(null);
    setSmartSearch("");
    setSearchResults([]);
    setShowResults(false);
    setVerifiedCustomer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerType]);

  const handleSave = async () => {
    if (saving) return;
    if (!fullName || !phone) return;

    setSaving(true);
    try {
      const existing = await searchCustomers(phone);
      const existingByName = await searchCustomers(fullName);

      const dup = [...existing, ...existingByName].find(
        (c) =>
          String(c.mobile || c.phone || "").toLowerCase() === phone.toLowerCase() ||
          String(c.name || "").toLowerCase() === fullName.toLowerCase()
      );

      if (dup) {
        const newCustomer = {
          id: "TEMP",
          name: fullName,
          email,
          mobile: phone,
          address: address || null,
          registeredVehiclesCount: 0,
          completedServicesCount: 0,
          customerSince: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
          vehicles: [],
        };
        setPendingCustomer(newCustomer);
        setShowDuplicateWarning(true);
        return;
      }

      const created = await createCustomer({ fullName, phone, email, address });
      setCustomerData(created);
      setVerifiedCustomer(created);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDuplicate = async () => {
    if (!pendingCustomer || saving) return;
    setSaving(true);
    try {
      const created = await createCustomer({
        fullName: pendingCustomer.name,
        phone: pendingCustomer.mobile,
        email: pendingCustomer.email,
        address: pendingCustomer.address,
      });
      setCustomerData(created);
      setVerifiedCustomer(created);
      setShowDuplicateWarning(false);
      setPendingCustomer(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateWarning(false);
    setPendingCustomer(null);
  };

  const handleVerifySearch = async () => {
    const term = smartSearch.trim();
    if (!term) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const matches = await searchCustomers(term);
    setSearchResults(matches);
    setShowResults(true);
  };

  const handleSelectCustomer = async (customer: any) => {
    const full = await getCustomerWithVehicles(customer.id);
    setVerifiedCustomer(full || customer);
    setCustomerData(full || customer);
    setSmartSearch("");
    setShowResults(false);
    setSearchResults([]);
  };

  // UI same as yours (unchanged)
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-user"></i>
        <h2>Customer Information</h2>
      </div>
      <div className="form-card-content">
        <div className="option-selector">
          <div className={`option-btn ${customerType === "new" ? "selected" : ""}`} onClick={() => setCustomerType("new")}>
            New Customer
          </div>
          <div className={`option-btn ${customerType === "existing" ? "selected" : ""}`} onClick={() => setCustomerType("existing")}>
            Existing Customer
          </div>
        </div>

        {customerType === "new" && !verifiedCustomer && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Optional" />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving || !fullName || !phone}>
              {saving ? "Saving..." : "Save Customer"}
            </button>
          </div>
        )}

        {customerType === "existing" && (
          <div>
            <div className="form-group" style={{ position: "relative" }}>
              <label>Search Customer</label>
              <div className="smart-search-wrapper">
                <i className="fas fa-search" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#888" }}></i>
                <input
                  type="text"
                  className="smart-search-input"
                  placeholder="Search by name, customer ID, mobile, or email..."
                  value={smartSearch}
                  onChange={(e) => setSmartSearch(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && void handleVerifySearch()}
                  style={{ paddingLeft: "40px" }}
                />
              </div>
              <button className="btn btn-primary" onClick={() => void handleVerifySearch()} style={{ marginTop: "10px" }}>
                <i className="fas fa-search"></i> Verify Customer
              </button>

              {showResults && searchResults.length > 0 && (
                <div className="customer-search-results">
                  {searchResults.map((customer) => (
                    <div key={customer.id} className="customer-result-item">
                      <div className="customer-result-info">
                        <div className="customer-result-name">
                          <strong>{customer.name}</strong>
                        </div>
                        <div className="customer-result-details">
                          <span className="customer-detail-chip">
                            <i className="fas fa-id-card"></i> {customer.id}
                          </span>
                          <span className="customer-detail-chip">
                            <i className="fas fa-phone"></i> {customer.mobile}
                          </span>
                          <span className="customer-detail-chip">
                            <i className="fas fa-envelope"></i> {customer.email}
                          </span>
                        </div>
                      </div>
                      <button className="btn btn-verify" onClick={() => void handleSelectCustomer(customer)}>
                        <i className="fas fa-check"></i> Select
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showResults && searchResults.length === 0 && (
                <div className="customer-search-results">
                  <div className="no-results-message">
                    <i className="fas fa-search"></i>
                    <p>No customers found matching your search</p>
                  </div>
                </div>
              )}
            </div>

            {verifiedCustomer && (
              <div className="verified-customer-display">
                <div className="verified-header">
                  <i className="fas fa-check-circle"></i>
                  <span>Customer Verified</span>
                </div>
                <div className="verified-info">
                  <div className="verified-row">
                    <span className="verified-label">Name:</span>
                    <span className="verified-value">{verifiedCustomer.name}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Customer ID:</span>
                    <span className="verified-value">{verifiedCustomer.id}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Email:</span>
                    <span className="verified-value">{verifiedCustomer.email}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Mobile:</span>
                    <span className="verified-value">{verifiedCustomer.mobile}</span>
                  </div>
                  {verifiedCustomer.address && (
                    <div className="verified-row">
                      <span className="verified-label">Address:</span>
                      <span className="verified-value">{verifiedCustomer.address}</span>
                    </div>
                  )}
                  <div className="verified-row">
                    <span className="verified-label">Registered Vehicles:</span>
                    <span className="verified-value">{verifiedCustomer.vehicles?.length ?? verifiedCustomer.registeredVehiclesCount ?? 0}</span>
                  </div>
                </div>
                <button
                  className="btn btn-change-customer"
                  onClick={() => {
                    setVerifiedCustomer(null);
                    setCustomerData(null);
                    setSmartSearch("");
                    setShowResults(false);
                    setSearchResults([]);
                  }}
                >
                  <i className="fas fa-sync-alt"></i> Change Customer
                </button>
              </div>
            )}
          </div>
        )}

        {customerType === "new" && verifiedCustomer && (
          <div className="verified-customer-display">
            <div className="verified-header">
              <i className="fas fa-check-circle"></i>
              <span>Customer Verified</span>
            </div>
            <div className="verified-info">
              <div className="verified-row">
                <span className="verified-label">Name:</span>
                <span className="verified-value">{verifiedCustomer.name}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Customer ID:</span>
                <span className="verified-value">{verifiedCustomer.id}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Mobile:</span>
                <span className="verified-value">{verifiedCustomer.mobile}</span>
              </div>
            </div>
            <button
              className="btn btn-change-customer"
              onClick={() => {
                setVerifiedCustomer(null);
                setCustomerData(null);
                setFullName("");
                setEmail("");
                setPhone("");
                setAddress("");
              }}
            >
              <i className="fas fa-edit"></i> Edit Customer
            </button>
          </div>
        )}

        {showDuplicateWarning && (
          <div className="warning-dialog-overlay">
            <div className="warning-dialog">
              <div className="warning-dialog-header">
                <i className="fas fa-exclamation-circle"></i>
                <span>Duplicate Customer Warning</span>
              </div>
              <div className="warning-dialog-body">
                <p>This customer already exists in the system.</p>
                <p>
                  <strong>Name:</strong> {pendingCustomer?.name}
                </p>
                <p>
                  <strong>Mobile:</strong> {pendingCustomer?.mobile}
                </p>
                <p className="warning-message">Are you sure you want to save as a new customer?</p>
              </div>
              <div className="warning-dialog-footer">
                <button className="btn btn-danger" onClick={() => void handleConfirmDuplicate()}>
                  <i className="fas fa-check"></i> Yes, Save Anyway
                </button>
                <button className="btn btn-secondary" onClick={handleCancelDuplicate}>
                  <i className="fas fa-times"></i> No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!customerData}>
          Next: Vehicle
        </button>
      </div>
    </div>
  );
}

// ============================================
// VEHICLE STEP
// ============================================
function StepTwoVehicle({ vehicleData, setVehicleData, customerData, setCustomerData, onVehicleSelected, onNext, onBack }: any) {
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false);
  const [factory, setFactory] = useState("Toyota");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<any>(new Date().getFullYear());
  const [license, setLicense] = useState("");
  const [carType, setCarType] = useState("SUV");
  const [color, setColor] = useState("");
  const [vinNumber, setVinNumber] = useState(""); // ✅ NEW manual VIN

  const hasVehicles = customerData?.vehicles && customerData.vehicles.length > 0;

  useEffect(() => {
    if (!hasVehicles) setShowNewVehicleForm(true);
  }, [hasVehicles]);

  const handleSaveNewVehicle = async () => {
    if (!(factory && model && year && license && carType && color && vinNumber)) return;

    const created = await createVehicleForCustomer({
      customerId: customerData.id,
      ownedBy: customerData.name,
      make: factory,
      model,
      year: String(year),
      color,
      plateNumber: license,
      vehicleType: carType,
      vin: vinNumber.trim().toUpperCase(), // ✅ manual VIN saved
    });

    const updatedCustomer = {
      ...customerData,
      vehicles: [...(customerData.vehicles || []), created],
      registeredVehiclesCount: (customerData.registeredVehiclesCount || 0) + 1,
    };

    setCustomerData(updatedCustomer);
    setVehicleData(created);
    setShowNewVehicleForm(false);

    if (onVehicleSelected) onVehicleSelected(created);
  };

  const handleSelectExistingVehicle = (vehicle: any) => {
    setVehicleData(vehicle);
    if (onVehicleSelected) onVehicleSelected(vehicle);
  };

  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-car"></i>
        <h2>Vehicle Information</h2>
      </div>
      <div className="form-card-content">
        {hasVehicles && !showNewVehicleForm && !vehicleData && (
          <div>
            <div className="info-banner" style={{ marginBottom: "20px" }}>
              <i className="fas fa-info-circle"></i>
              <span>This customer has {customerData.vehicles.length} registered vehicle(s). Select one or add a new vehicle.</span>
            </div>

            <h3 style={{ marginBottom: "15px", fontSize: "16px", fontWeight: "600" }}>Registered Vehicles</h3>
            <div className="vehicles-list">
              {customerData.vehicles.map((vehicle: any) => (
                <div key={vehicle.vehicleId} className="vehicle-result-item">
                  <div className="vehicle-result-info">
                    <div className="vehicle-result-name">
                      <strong>
                        {vehicle.make} {vehicle.model} ({vehicle.year})
                      </strong>
                    </div>
                    <div className="vehicle-result-details">
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-palette"></i> {vehicle.color}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-id-card"></i> {vehicle.plateNumber}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-car"></i> {vehicle.vehicleType}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-barcode"></i> {vehicle.vin}
                      </span>
                    </div>
                  </div>
                  <button className="btn btn-verify" onClick={() => handleSelectExistingVehicle(vehicle)}>
                    <i className="fas fa-check"></i> Select
                  </button>
                </div>
              ))}
            </div>

            <button className="btn btn-secondary" onClick={() => setShowNewVehicleForm(true)} style={{ marginTop: "15px" }}>
              <i className="fas fa-plus"></i> Add New Vehicle
            </button>
          </div>
        )}

        {(showNewVehicleForm || !hasVehicles) && !vehicleData && (
          <div>
            {hasVehicles && (
              <button className="btn btn-link" onClick={() => setShowNewVehicleForm(false)} style={{ marginBottom: "15px", padding: "8px 12px", fontSize: "14px" }}>
                <i className="fas fa-arrow-left"></i> Back to Vehicle Selection
              </button>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Manufacturer *</label>
                <select value={factory} onChange={(e) => setFactory(e.target.value)}>
                  <option>Toyota</option>
                  <option>Honda</option>
                  <option>Nissan</option>
                  <option>Ford</option>
                  <option>BMW</option>
                  <option>Mercedes</option>
                  <option>Hyundai</option>
                  <option>Kia</option>
                  <option>Chevrolet</option>
                  <option>Volkswagen</option>
                  <option>Audi</option>
                </select>
              </div>
              <div className="form-group">
                <label>Model *</label>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g., Camry" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Year *</label>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>License Plate *</label>
                <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g., 123456" />
              </div>
            </div>

            {/* ✅ NEW ROW: VIN + Vehicle Type */}
            <div className="form-row">
              <div className="form-group">
                <label>VIN Number *</label>
                <input
                  value={vinNumber}
                  onChange={(e) => setVinNumber(e.target.value.toUpperCase())}
                  placeholder="e.g., JTDBR32E720054321"
                  maxLength={30}
                />
              </div>
              <div className="form-group">
                <label>Vehicle Type *</label>
                <select value={carType} onChange={(e) => setCarType(e.target.value)}>
                  <option>SUV</option>
                  <option>Sedan</option>
                  <option>Hatchback</option>
                  <option>Coupe</option>
                  <option>Truck</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Color *</label>
                <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g., Silver Metallic" />
              </div>
            </div>

            <button
              className="btn btn-success"
              onClick={() => void handleSaveNewVehicle()}
              disabled={!(factory && model && year && license && carType && color && vinNumber)}
            >
              <i className="fas fa-save"></i> Save Vehicle
            </button>
          </div>
        )}

        {vehicleData && (
          <div className="verified-customer-display" style={{ marginTop: "0" }}>
            <div className="verified-header">
              <i className="fas fa-check-circle"></i>
              <span>Vehicle Selected</span>
            </div>
            <div className="verified-info">
              <div className="verified-row">
                <span className="verified-label">Vehicle:</span>
                <span className="verified-value">
                  {vehicleData.make} {vehicleData.model} ({vehicleData.year})
                </span>
              </div>
              <div className="verified-row">
                <span className="verified-label">License Plate:</span>
                <span className="verified-value">{vehicleData.plateNumber}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Type:</span>
                <span className="verified-value">{vehicleData.vehicleType}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Color:</span>
                <span className="verified-value">{vehicleData.color}</span>
              </div>
              {vehicleData.vin && (
                <div className="verified-row">
                  <span className="verified-label">VIN:</span>
                  <span className="verified-value">{vehicleData.vin}</span>
                </div>
              )}
            </div>
            <button className="btn btn-change-customer" onClick={() => setVehicleData(null)}>
              <i className="fas fa-sync-alt"></i> Change Vehicle
            </button>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!vehicleData}>
          Next: Services
        </button>
      </div>
    </div>
  );
}

// ============================================
// SERVICES STEP (same UI)
// ============================================
function StepThreeServices({
  selectedServices,
  setSelectedServices,
  vehicleType,
  discountPercent,
  setDiscountPercent,
  orderNotes,
  setOrderNotes,
  expectedDeliveryDate,
  setExpectedDeliveryDate,
  expectedDeliveryTime,
  setExpectedDeliveryTime,
  onNext,
  onBack,
}: any) {
  const handleToggleService = (product: any) => {
    const price = vehicleType === "SUV" ? product.suvPrice : product.sedanPrice;
    if (selectedServices.some((s: any) => s.name === product.name)) {
      setSelectedServices(selectedServices.filter((s: any) => s.name !== product.name));
    } else {
      setSelectedServices([...selectedServices, { name: product.name, price }]);
    }
  };

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;

  const subtotal = selectedServices.reduce((sum: number, s: any) => sum + s.price, 0);
  const discount = (subtotal * discountPercent) / 100;
  const total = subtotal - discount;

  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-concierge-bell"></i>
        <h2>Services Selection</h2>
      </div>

      <div className="form-card-content">
        <p>Select services for {vehicleType}:</p>

        <div className="services-grid">
          {YOUR_PRODUCTS.map((product) => (
            <div
              key={product.name}
              className={`service-checkbox ${selectedServices.some((s: any) => s.name === product.name) ? "selected" : ""}`}
              onClick={() => handleToggleService(product)}
            >
              <div className="service-info">
                <div className="service-name">{product.name}</div>
              </div>
              <div className="service-price">{formatPrice(vehicleType === "SUV" ? product.suvPrice : product.sedanPrice)}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", color: "#333" }}>
            <i className="fas fa-sticky-note" style={{ marginRight: "8px" }}></i>
            Notes / Comments (Optional)
          </label>
          <textarea
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder="Add any special instructions, notes, or comments for this order..."
            rows={4}
            style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginTop: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", color: "#333" }}>
            <i className="fas fa-calendar-check" style={{ marginRight: "8px" }}></i>
            Expected Delivery Date & Time
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <input
                type="time"
                value={expectedDeliveryTime}
                onChange={(e) => setExpectedDeliveryTime(e.target.value)}
                style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
          </div>
        </div>

        <div className="price-summary-box">
          <h4>Price Summary</h4>
          <div className="price-row">
            <span>Services:</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="price-row">
            <span>Apply Discount:</span>
            <div>
              <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(parseFloat(e.target.value) || 0)} style={{ width: "80px", color: "#333", backgroundColor: "#fff" }} />
              <span> %</span>
            </div>
          </div>
          <div className="price-row discount-amount">
            <span>Discount Amount:</span>
            <span>{formatPrice(discount)}</span>
          </div>
          <div className="price-row total">
            <span>Total:</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={selectedServices.length === 0}>
          Next: Confirm
        </button>
      </div>
    </div>
  );
}

// ============================================
// ADD SERVICE SCREEN
// ============================================
function AddServiceScreen({ order, onClose, onSubmit }: any) {
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const vehicleType = order?.vehicleDetails?.type || "SUV";

  const handleToggleService = (product: any) => {
    const price = vehicleType === "SUV" ? product.suvPrice : product.sedanPrice;
    if (selectedServices.some((s) => s.name === product.name)) {
      setSelectedServices(selectedServices.filter((s) => s.name !== product.name));
    } else {
      setSelectedServices([...selectedServices, { name: product.name, price }]);
    }
  };

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const subtotal = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const discount = (subtotal * discountPercent) / 100;
  const total = subtotal - discount;

  return (
<div className="pim-details-screen jo-details-v3">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-plus-circle"></i> Add Services to Job Order
          </h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> Cancel
        </button>
      </div>

      <div className="pim-details-body">
        <div className="form-card">
          <div className="form-card-title">
            <i className="fas fa-concierge-bell"></i>
            <h2>Services Selection</h2>
          </div>

          <div className="form-card-content">
            <p>Select services for {vehicleType}:</p>
            <div className="services-grid">
              {YOUR_PRODUCTS.map((product) => (
                <div key={product.name} className={`service-checkbox ${selectedServices.some((s) => s.name === product.name) ? "selected" : ""}`} onClick={() => handleToggleService(product)}>
                  <div className="service-info">
                    <div className="service-name">{product.name}</div>
                  </div>
                  <PermissionGate moduleId="joborder" optionId="joborder_serviceprice">
                    <div className="service-price">{formatPrice(vehicleType === "SUV" ? product.suvPrice : product.sedanPrice)}</div>
                  </PermissionGate>
                </div>
              ))}
            </div>

            <div className="price-summary-box">
              <h4>Price Summary</h4>
              <div className="price-row">
                <span>Services:</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <PermissionGate moduleId="joborder" optionId="joborder_servicediscount">
                <div className="price-row">
                  <span>Apply Discount:</span>
                  <div>
                    <PermissionGate moduleId="joborder" optionId="joborder_servicediscount_percent">
                      <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(parseFloat(e.target.value) || 0)} style={{ width: "80px" }} />
                      <span> %</span>
                    </PermissionGate>
                  </div>
                </div>
              </PermissionGate>
              <div className="price-row discount-amount">
                <span>Discount Amount:</span>
                <span>{formatPrice(discount)}</span>
              </div>
              <div className="price-row total">
                <span>Total:</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => onSubmit({ selectedServices, discountPercent })} disabled={selectedServices.length === 0}>
                Add Services
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectionModal({ item, onClose }: any) {
  if (!item) return null;
  return (
    <div className="inspection-modal" style={{ display: "flex" }} onClick={onClose}>
      <div className="inspection-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="inspection-modal-header">
          <h3>
            <i className="fas fa-search"></i> {item.name}
          </h3>
          <button className="inspection-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="inspection-modal-body">
          <div className="inspection-detail-section">
            <h4>Details</h4>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value">{item.status}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Notes</span>
                <span className="detail-value">{item.notes}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CONFIRM STEP
// ============================================
function StepFourConfirm({
  orderType,
  customerData,
  vehicleData,
  selectedServices,
  discountPercent,
  orderNotes,
  expectedDeliveryDate,
  expectedDeliveryTime,
  onBack,
  onSubmit,
}: any) {
  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const subtotal = selectedServices.reduce((sum: number, s: any) => sum + s.price, 0);
  const discount = (subtotal * discountPercent) / 100;
  const total = subtotal - discount;

  const customerMobile = customerData?.mobile || customerData?.phone || "Not provided";
  const vehicleType = vehicleData?.vehicleType || vehicleData?.carType || "N/A";
  const vehicleId = vehicleData?.vehicleId || "N/A";
  const plate = vehicleData?.plateNumber || vehicleData?.license || "N/A";
  const vin = vehicleData?.vin || "Not provided";


  return (
    <div className="form-card confirm-review-card">
      <div className="form-card-title">
        <i className="fas fa-check-circle"></i>
        <h2>Order Confirmation</h2>
      </div>

      <div className="form-card-content">
        {/* Top summary strip similar to screenshot */}
        <div className="jo-confirm-top-strip">
          <div className="jo-confirm-top-strip-left">
            <div className="jo-confirm-order-type-line">
              <i className="fas fa-file-alt"></i>
              <div>
                <div className="jo-confirm-strip-title">{orderType === "service" ? "Service Order" : "New Job Order"}</div>
                <div className="jo-confirm-strip-subtitle">
                  {[vehicleData?.make, vehicleData?.model].filter(Boolean).join(" ")} {plate ? `• ${plate}` : ""}
                </div>
              </div>
            </div>
          </div>
          <button className="btn btn-secondary jo-confirm-change-type-btn" onClick={onBack}>
            <i className="fas fa-exchange-alt"></i> Change Selection
          </button>
        </div>

        {/* Customer */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-user"></i> Customer Information
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>Customer ID</span>
              <strong>{customerData?.id || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Customer Name</span>
              <strong>{customerData?.name || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Mobile Number</span>
              <strong>{customerMobile}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Email Address</span>
              <strong>{customerData?.email || "Not provided"}</strong>
            </div>
            <div className="jo-confirm-item jo-confirm-item-wide">
              <span>Home Address</span>
              <strong>{customerData?.address || "Not provided"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Registered Vehicles</span>
              <strong>{customerData?.vehicles?.length ?? customerData?.registeredVehiclesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Completed Services</span>
              <strong>{customerData?.completedServicesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Customer Since</span>
              <strong>{customerData?.customerSince || "N/A"}</strong>
            </div>
          </div>
        </section>

        {/* Vehicle */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-car"></i> Vehicle Information
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>Vehicle ID</span>
              <strong>{vehicleId}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Owned By</span>
              <strong>{customerData?.name || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Make</span>
              <strong>{vehicleData?.make || vehicleData?.factory || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Model</span>
              <strong>{vehicleData?.model || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Year</span>
              <strong>{vehicleData?.year || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Color</span>
              <strong>{vehicleData?.color || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Plate Number</span>
              <strong>{plate}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>VIN</span>
              <strong>{vin}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Vehicle Type</span>
              <strong>{vehicleType}</strong>
            </div>
          </div>
        </section>

        {/* Selected services table */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-clipboard-list"></i> Selected Services
          </h3>

          <div className="jo-confirm-table-wrap">
            <table className="jo-confirm-services-table">
              <thead>
                <tr>
                  <th>Service Name</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {selectedServices.map((service: any, idx: number) => (
                  <tr key={`${service.name}-${idx}`}>
                    <td>{service.name}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{formatPrice(service.price || 0)}</td>
                  </tr>
                ))}
                {selectedServices.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "#64748b" }}>
                      No services selected
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Price summary */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-calculator"></i> Price Summary
          </h3>
          <div className="jo-price-summary-grid">
            <div className="jo-price-box">
              <div className="jo-price-row">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>
              <div className="jo-price-row">
                <span>Discount ({discountPercent || 0}%)</span>
                <strong>- {formatPrice(discount)}</strong>
              </div>
            </div>

            <div className="jo-price-box jo-price-box-total">
              <div className="jo-price-row">
                <span>Total</span>
                <strong>{formatPrice(total)}</strong>
              </div>
            </div>
          </div>
        </section>

        {(orderNotes || expectedDeliveryDate || expectedDeliveryTime) && (
          <section className="jo-confirm-section">
            <h3>
              <i className="fas fa-info-circle"></i> Additional Information
            </h3>
            <div className="jo-confirm-grid">
              <div className="jo-confirm-item">
                <span>Expected Delivery Date</span>
                <strong>{expectedDeliveryDate || "Not specified"}</strong>
              </div>
              <div className="jo-confirm-item">
                <span>Expected Delivery Time</span>
                <strong>{expectedDeliveryTime || "Not specified"}</strong>
              </div>
              <div className="jo-confirm-item jo-confirm-item-wide">
                <span>Notes / Comments</span>
                <strong style={{ whiteSpace: "pre-wrap" }}>{orderNotes || "No notes"}</strong>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="action-buttons confirm-action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-success" onClick={onSubmit}>
          Submit Order
        </button>
      </div>
    </div>
  );
}

// ============================================
// SIMPLE DISPLAY CARDS
// ============================================
function JobOrderSummaryCard({ order }: any) {
  const summary = order.jobOrderSummary || {};
  const delivery = order.deliveryInfo || {};
  const serviceProgress = order.serviceProgressInfo || {};
    const createdBy = resolveCreatedBy(order);

  
  return (
    <div className="epm-detail-card">
      <h3>
        <i className="fas fa-info-circle"></i> Job Order Summary
      </h3>
      <div className="epm-card-content">
        <div className="epm-info-item">
          <span className="epm-info-label">Job Order ID</span>
          <span className="epm-info-value">{order.id}</span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Order Type</span>
          <span className="epm-info-value">{order.orderType}</span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Work Status</span>
          <span className={`epm-status-badge status-badge ${getWorkStatusClass(order.workStatus)}`}>{order.workStatus}</span>
        </div>
        <div className="epm-info-item">
          <span className="epm-info-label">Payment Status</span>
          <span className={`epm-status-badge status-badge ${getPaymentStatusClass(order.paymentStatus)}`}>{order.paymentStatus}</span>
        </div>
        
        {/* ✅ NEW: Priority Level */}
        {order.priorityLevel && (
          <div className="epm-info-item">
            <span className="epm-info-label">Priority</span>
            <span 
              className="epm-priority-badge"
              style={{ 
                backgroundColor: order.priorityBg, 
                color: order.priorityColor,
                padding: '4px 12px',
                borderRadius: '4px',
                fontWeight: '600'
              }}
            >
              {order.priorityLevel}
            </span>
          </div>
        )}
        
        {/* ✅ NEW: Service Progress */}
        {serviceProgress.progress && (
          <div className="epm-info-item" style={{ gridColumn: 'span 2' }}>
            <span className="epm-info-label">Service Progress</span>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', width: '100%' }}>
              <div style={{ flex: 1 }}>
                <div className="epm-progress-bar">
                  <div 
                    className="epm-progress-fill" 
                    style={{ width: `${serviceProgress.progress.percent}%` }}
                  ></div>
                </div>
              </div>
              <span className="epm-progress-text">{serviceProgress.progress.label}</span>
            </div>
          </div>
        )}
        
        {summary.createDate && (
          <div className="epm-info-item">
            <span className="epm-info-label">Created On</span>
            <span className="epm-info-value">{summary.createDate}</span>
          </div>
        )}

{createdBy && createdBy !== "—" && (
  <div className="epm-info-item">
    <span className="epm-info-label">Created By</span>
    <span className="epm-info-value">{createdBy}</span>
  </div>
)}
        {summary.expectedDelivery && (
          <div className="epm-info-item">
            <span className="epm-info-label">Expected Delivery</span>
            <span className="epm-info-value">{summary.expectedDelivery}</span>
          </div>
        )}
        
        {/* ✅ NEW: Estimated vs Actual Hours */}
        {(delivery.estimatedHours || delivery.actualHours) && (
          <div className="epm-info-item">
            <span className="epm-info-label">Time Estimate</span>
            <span className="epm-info-value">
              Est: {delivery.estimatedHours || 'N/A'} {delivery.actualHours && `| Actual: ${delivery.actualHours}`}
            </span>
          </div>
        )}
        
        {order.customerNotes && (
          <div className="epm-info-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span className="epm-info-label">Customer Notes</span>
            <span className="epm-info-value" style={{ whiteSpace: 'pre-wrap', fontSize: '13px' }}>{order.customerNotes}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerDetailsCard({ order }: any) {
  const customerDetails = order.customerDetails || {};
  
  return (
    <div className="pim-detail-card">
      <h3>
        <i className="fas fa-user"></i> Customer Information
      </h3>
      <div className="pim-card-content">
        <div className="pim-info-item">
          <span className="pim-info-label">Customer Name</span>
          <span className="pim-info-value">{order.customerName}</span>
        </div>
        <div className="pim-info-item">
          <span className="pim-info-label">Mobile</span>
          <span className="pim-info-value">{order.mobile}</span>
        </div>
        {customerDetails.email && (
          <div className="pim-info-item">
            <span className="pim-info-label">Email</span>
            <span className="pim-info-value">{customerDetails.email}</span>
          </div>
        )}
        {customerDetails.customerId && (
          <div className="pim-info-item">
            <span className="pim-info-label">Customer ID</span>
            <span className="pim-info-value">{customerDetails.customerId}</span>
          </div>
        )}
        
        {/* ✅ NEW: Customer Address */}
        {customerDetails.address && (
          <div className="pim-info-item">
            <span className="pim-info-label">Address</span>
            <span className="pim-info-value">{customerDetails.address}</span>
          </div>
        )}
        
        {/* ✅ NEW: Customer Company */}
        {customerDetails.company && (
          <div className="pim-info-item">
            <span className="pim-info-label">Company</span>
            <span className="pim-info-value">{customerDetails.company}</span>
          </div>
        )}
        
        {/* ✅ NEW: Customer Since */}
        {customerDetails.customerSince && (
          <div className="pim-info-item">
            <span className="pim-info-label">Customer Since</span>
            <span className="pim-info-value">{customerDetails.customerSince}</span>
          </div>
        )}
        
        {/* ✅ NEW: Registered Vehicles Count */}
        {customerDetails.registeredVehiclesCount !== undefined && (
          <div className="pim-info-item">
            <span className="pim-info-label">Registered Vehicles</span>
            <span className="pim-info-value">{customerDetails.registeredVehiclesCount}</span>
          </div>
        )}
        
        {customerDetails.completedServicesCount !== undefined && (
          <div className="pim-info-item">
            <span className="pim-info-label">Completed Services</span>
            <span className="pim-info-value">{customerDetails.completedServicesCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VehicleDetailsCard({ order }: any) {
  const vehicleDetails = order.vehicleDetails || {};
  
  return (
    <div className="pim-detail-card">
      <h3>
        <i className="fas fa-car"></i> Vehicle Information
      </h3>
      <div className="pim-card-content">
        <div className="pim-info-item">
          <span className="pim-info-label">Plate Number</span>
          <span className="pim-info-value">{order.vehiclePlate || vehicleDetails.plateNumber}</span>
        </div>
        {vehicleDetails.vehicleId && (
          <div className="pim-info-item">
            <span className="pim-info-label">Vehicle ID</span>
            <span className="pim-info-value">{vehicleDetails.vehicleId}</span>
          </div>
        )}
        {vehicleDetails.make && (
          <div className="pim-info-item">
            <span className="pim-info-label">Make & Model</span>
            <span className="pim-info-value">{vehicleDetails.make} {vehicleDetails.model}</span>
          </div>
        )}
        {vehicleDetails.year && (
          <div className="pim-info-item">
            <span className="pim-info-label">Year</span>
            <span className="pim-info-value">{vehicleDetails.year}</span>
          </div>
        )}
        {vehicleDetails.type && (
          <div className="pim-info-item">
            <span className="pim-info-label">Vehicle Type</span>
            <span className="pim-info-value">{vehicleDetails.type}</span>
          </div>
        )}
        {vehicleDetails.color && (
          <div className="pim-info-item">
            <span className="pim-info-label">Color</span>
            <span className="pim-info-value">{vehicleDetails.color}</span>
          </div>
        )}
        {vehicleDetails.vin && (
          <div className="pim-info-item">
            <span className="pim-info-label">VIN</span>
            <span className="pim-info-value">{vehicleDetails.vin}</span>
          </div>
        )}
        {/* ✅ NEW: Registration Date */}
        {vehicleDetails.registrationDate && (
          <div className="pim-info-item">
            <span className="pim-info-label">Registration Date</span>
            <span className="pim-info-value">{vehicleDetails.registrationDate}</span>
          </div>
        )}
        {vehicleDetails.mileage && (
          <div className="pim-info-item">
            <span className="pim-info-label">Mileage</span>
            <span className="pim-info-value">{vehicleDetails.mileage}</span>
          </div>
        )}
        {vehicleDetails.ownedBy && (
          <div className="pim-info-item">
            <span className="pim-info-label">Owned By</span>
            <span className="pim-info-value">{vehicleDetails.ownedBy}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ServicesCard({ order, onAddService }: any) {
  const serviceProgress = order.serviceProgressInfo || {};
  
  return (
    <div className="pim-detail-card" style={{ gridColumn: 'span 12' }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 12px 0' }}>
            <i className="fas fa-tasks"></i> Services Summary ({order.services?.length || 0})
          </h3>
          {/* ✅ NEW: Service Progress Bar */}
          {serviceProgress.progress && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ flex: 1, minHeight: '8px' }}>
                <div className="epm-progress-bar" style={{ height: '8px' }}>
                  <div 
                    className="epm-progress-fill" 
                    style={{ width: `${serviceProgress.progress.percent}%`, height: '100%' }}
                  ></div>
                </div>
              </div>
              <span className="epm-progress-text" style={{ fontSize: '12px', color: '#666' }}>
                {serviceProgress.progress.label}
              </span>
            </div>
          )}
        </div>
        <PermissionGate moduleId="joborder" optionId="joborder_addservice">
          <button className="btn-add-service" onClick={onAddService} style={{ padding: "8px 16px", fontSize: "14px" }}>
            <i className="fas fa-plus-circle"></i> Add Service
          </button>
        </PermissionGate>
      </div>

      <div className="pim-services-list">
        {order.services && order.services.length > 0 ? (
          order.services.map((service: any, idx: number) => (
            <div key={idx} className="pim-service-item">
              <div className="pim-service-header">
                <span className="pim-service-name">{service.name}</span>
                <span className="pim-service-price">{service.price ? `QAR ${service.price.toLocaleString()}` : 'N/A'}</span>
              </div>
              <div className="pim-service-meta">
                <div className="pim-service-meta-row">
                  <span className="pim-service-meta-label">Status:</span>
                  <span className="pim-service-meta-value">{service.status || 'N/A'}</span>
                </div>
                {service.technician && (
                  <div className="pim-service-meta-row">
                    <span className="pim-service-meta-label">Technician:</span>
                    <span className="pim-service-meta-value">{service.technician}</span>
                  </div>
                )}
                {service.started && (
                  <div className="pim-service-meta-row">
                    <span className="pim-service-meta-label">Started:</span>
                    <span className="pim-service-meta-value">{service.started}</span>
                  </div>
                )}
                {service.ended && (
                  <div className="pim-service-meta-row">
                    <span className="pim-service-meta-label">Ended:</span>
                    <span className="pim-service-meta-value">{service.ended}</span>
                  </div>
                )}
                {service.duration && (
                  <div className="pim-service-meta-row">
                    <span className="pim-service-meta-label">Duration:</span>
                    <span className="pim-service-meta-value">{service.duration}</span>
                  </div>
                )}
                {service.notes && (
                  <div className="pim-service-meta-row" style={{ gridColumn: 'span 2' }}>
                    <span className="pim-service-meta-label">Notes:</span>
                    <span className="pim-service-meta-value">{service.notes}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state" style={{ padding: "30px", margin: '0' }}>
            <div className="empty-icon">
              <i className="fas fa-clipboard-list"></i>
            </div>
            <div className="empty-text">No services added yet</div>
            <div className="empty-subtext">Click "Add Service" to add services to this job order</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BillingCard({ order }: any) {
  const billing = order.billing || {};
  
  return (
    <div className="epm-detail-card" style={{ gridColumn: 'span 12' }}>
      <h3>
        <i className="fas fa-receipt"></i> Billing & Invoices
      </h3>

      {/* Billing Summary */}
      <div className="pim-billing-summary">
        <h4>
          <i className="fas fa-calculator"></i> Billing Summary
        </h4>
        <div className="pim-billing-row">
          <span className="pim-billing-label">Bill ID:</span>
          <span className="pim-billing-value">{billing.billId || "N/A"}</span>
        </div>
        <div className="pim-billing-row">
          <span className="pim-billing-label">Total Amount:</span>
          <span className="pim-billing-value">{billing.totalAmount || "N/A"}</span>
        </div>
        {billing.discount && (
          <div className="pim-billing-row">
            <span className="pim-billing-label">Discount:</span>
            <span className="pim-billing-value">-{billing.discount}</span>
          </div>
        )}
        <div className="pim-billing-row">
          <span className="pim-billing-label">Net Amount:</span>
          <span className="pim-billing-value">{billing.netAmount || "N/A"}</span>
        </div>
        <div className="pim-billing-row">
          <span className="pim-billing-label">Amount Paid:</span>
          <span className="pim-billing-value">{billing.amountPaid || "QAR 0"}</span>
        </div>
        <div className="pim-billing-row">
          <span className="pim-billing-label">Balance Due:</span>
          <span className="pim-billing-value">{billing.balanceDue || "N/A"}</span>
        </div>
      </div>

      {/* Invoices List */}
      {billing.invoices && billing.invoices.length > 0 && (
        <div>
          <h4 style={{ marginTop: '20px', marginBottom: '12px', fontSize: '15px', fontWeight: '700', color: '#1e293b' }}>
            <i className="fas fa-file-invoice" style={{ marginRight: '8px' }}></i>
            Invoices ({billing.invoices.length})
          </h4>
          <div className="pim-invoices-list">
            {billing.invoices.map((invoice: any, idx: number) => (
              <div key={idx} className="pim-invoice-card">
                <div className="pim-invoice-header">
                  <div className="pim-invoice-number">
                    <i className="fas fa-file-alt"></i>
                    {invoice.number}
                  </div>
                  <span className={`pim-invoice-status ${invoice.status?.toLowerCase() || 'unpaid'}`}>
                    {invoice.status || 'Unpaid'}
                  </span>
                </div>
                <div className="pim-invoice-details">
                  <div className="pim-invoice-detail-item">
                    <span className="pim-invoice-detail-label">Amount:</span>
                    <span className="pim-invoice-detail-value">{invoice.amount}</span>
                  </div>
                  {invoice.discount && (
                    <div className="pim-invoice-detail-item">
                      <span className="pim-invoice-detail-label">Discount:</span>
                      <span className="pim-invoice-detail-value">-{invoice.discount}</span>
                    </div>
                  )}
                  {invoice.paymentMethod && (
                    <div className="pim-invoice-detail-item">
                      <span className="pim-invoice-detail-label">Payment Method:</span>
                      <span className="pim-invoice-detail-value">{invoice.paymentMethod}</span>
                    </div>
                  )}
                </div>
                {invoice.services && invoice.services.length > 0 && (
                  <div className="pim-invoice-services">
                    <div className="pim-invoice-services-title">Services Included:</div>
                    <div className="pim-invoice-services-list">
                      {invoice.services.map((service: string, sidx: number) => (
                        <span key={sidx} className="pim-invoice-service-tag">{service}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentActivityLogCard({ order }: any) {
  if (!order.paymentActivityLog || order.paymentActivityLog.length === 0) return null;

  return (
    <div className="pim-detail-card">
      <h3>
        <i className="fas fa-history"></i> Payment Activity Log
      </h3>
      <table className="pim-payment-log-table">
        <thead>
          <tr>
            <th>Serial</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Timestamps</th>
            {/* ✅ NEW: Show receipt/transaction fields if available */}
            {order.paymentActivityLog.some((p: any) => p.receiptNumber || p.transactionId) && (
              <>
                <th>Receipt #</th>
                <th>Transaction ID</th>
              </>
            )}
            {order.paymentActivityLog.some((p: any) => p.paymentStatus) && (
              <th>Status</th>
            )}
            {order.paymentActivityLog.some((p: any) => p.approvedBy) && (
              <th>Approved By</th>
            )}
            <th>Cashier</th>
          </tr>
        </thead>
        <tbody>
          {[...order.paymentActivityLog].reverse().map((payment: any, idx: number) => (
            <tr key={idx}>
              <td className="pim-serial-column">{payment.serial}</td>
              <td className="pim-amount-column">{payment.amount}</td>
              <td className="pim-cashier-column">{payment.paymentMethod}</td>
              <td className="pim-timestamp-column">{payment.timestamp}</td>
              {/* ✅ NEW: Receipt and Transaction Info */}
              {order.paymentActivityLog.some((p: any) => p.receiptNumber || p.transactionId) && (
                <>
                  <td className="pim-receipt-column">
                    {payment.receiptNumber ? (
                      <span className="pim-payment-detail">
                        <i className="fas fa-receipt"></i> {payment.receiptNumber}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="pim-transaction-column">
                    {payment.transactionId ? (
                      <span className="pim-payment-detail">
                        <i className="fas fa-exchange-alt"></i> {payment.transactionId}
                      </span>
                    ) : '-'}
                  </td>
                </>
              )}
              {/* ✅ NEW: Payment Status */}
              {order.paymentActivityLog.some((p: any) => p.paymentStatus) && (
                <td className="pim-status-column">
                  <span className={`pim-payment-status ${(payment.paymentStatus || '').toLowerCase()}`}>
                    {payment.paymentStatus || '-'}
                  </span>
                </td>
              )}
              {/* ✅ NEW: Approval Info */}
              {order.paymentActivityLog.some((p: any) => p.approvedBy) && (
                <td className="pim-approver-column">
                  {payment.approvedBy ? (
                    <span>
                      {payment.approvedBy}
                      {payment.approvalDate && <br />}
                      {payment.approvalDate && <small style={{ color: '#666' }}>{payment.approvalDate}</small>}
                    </span>
                  ) : '-'}
                </td>
              )}
<td className="pim-cashier-column">{resolveCashierName(payment)}</td>            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}



type DocUi = {
  id?: string;
  name?: string;
  type?: string;
  category?: string;
  addedAt?: string;
  uploadedBy?: string;
  storagePath?: string; // e.g. "job-orders/....pdf"
  url?: string;         // full url or fallback
  paymentReference?: string;
  billReference?: string;
};

function JobOrderDocumentsCard({ order }: any) {
  const docs: DocUi[] = Array.isArray(order?.documents) ? order.documents : [];
  if (!docs.length) return null;

  return (
    <div className="pim-detail-card jo-docs-card">
      <h3 className="jo-docs-title">
        <span className="jo-docs-title-left">
          <i className="fas fa-folder-open"></i> Documents ({docs.length})
        </span>
      </h3>

      <div className="pim-card-content jo-docs-content">
        <div className="jo-docs-table-wrap">
          <table className="jo-docs-table">
            <thead>
              <tr>
                <th className="jo-docs-th jo-docs-col-doc">Document</th>
                <th className="jo-docs-th jo-docs-col-type">Type</th>
                <th className="jo-docs-th jo-docs-col-cat">Category</th>
                <th className="jo-docs-th jo-docs-col-added">Added</th>
                <th className="jo-docs-th jo-docs-col-by">Uploaded By</th>
                <th className="jo-docs-th jo-docs-col-actions jo-docs-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {docs.map((d, idx) => {
                const name = String(d?.name ?? "").trim() || `Document ${idx + 1}`;
                const raw = String(d?.storagePath || d?.url || "").trim();
                const type = String(d?.type ?? "").trim() || "—";
                const category = String(d?.category ?? "").trim() || "—";
                const addedAt = String(d?.addedAt ?? "").trim() || "—";
                const uploadedBy = String(d?.uploadedBy ?? "").trim() || "—";

                const refs = [
                  d?.paymentReference ? `PaymentRef: ${d.paymentReference}` : null,
                  d?.billReference ? `BillRef: ${d.billReference}` : null,
                ].filter(Boolean);

                return (
                  <tr key={d?.id ?? `${name}-${idx}`} className="jo-docs-row">
                    <td className="jo-docs-td jo-docs-col-doc">
                      <div className="jo-docs-docname">{name}</div>

                      {(refs.length > 0 || raw) ? (
                        <div className="jo-docs-docmeta">
                          {refs.join(" • ")}
                          {raw ? (refs.length ? " • " : "") : ""}
                          {raw ? raw : ""}
                        </div>
                      ) : null}
                    </td>

                    <td className="jo-docs-td jo-docs-col-type">{type}</td>
                    <td className="jo-docs-td jo-docs-col-cat">{category}</td>
                    <td className="jo-docs-td jo-docs-col-added">{addedAt}</td>
                    <td className="jo-docs-td jo-docs-col-by">{uploadedBy}</td>

                    <td className="jo-docs-td jo-docs-col-actions jo-docs-right">
                      <PermissionGate moduleId="joborder" optionId="joborder_download">
                        <div className="jo-docs-actions">
                          <button
                            type="button"
                            className="btn btn-secondary jo-docs-btn"
                            disabled={!raw}
                            onClick={async () => {
                              const linkUrl = await resolveMaybeStorageUrl(raw);
                              if (!linkUrl) return;
                              window.open(linkUrl, "_blank", "noopener,noreferrer");
                            }}
                            title={!raw ? "No file path/url available" : "Open"}
                          >
                            <i className="fas fa-external-link-alt"></i> Open
                          </button>

                          <button
                            type="button"
                            className="btn btn-primary jo-docs-btn"
                            disabled={!raw}
                            onClick={async () => {
                              const linkUrl = await resolveMaybeStorageUrl(raw);
                              if (!linkUrl) return;
                              const a = document.createElement("a");
                              a.href = linkUrl;
                              a.download = name || "document";
                              a.click();
                            }}
                            title={!raw ? "No file path/url available" : "Download"}
                          >
                            <i className="fas fa-download"></i> Download
                          </button>
                        </div>
                      </PermissionGate>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
// ============================================
// ✅ NEW: QUALITY CHECK CARD
// ============================================
function QualityCheckCard({ order }: any) {
  const qc = order.qualityCheck || {};
  
  if (!qc.status) return null;

  const getQCStatusClass = (status: string) => {
    const s = String(status || '').toUpperCase();
    if (s === 'PASSED') return 'passed';
    if (s === 'FAILED') return 'failed';
    if (s === 'IN_PROGRESS') return 'in-progress';
    return 'pending';
  };

  return (
    <div className="pim-detail-card">
      <h3>
        <i className="fas fa-check-double"></i> Quality Check
      </h3>
      <div className="pim-card-content">
        <div className="pim-info-item">
          <span className="pim-info-label">Status</span>
          <span className={`pim-qc-status-badge ${getQCStatusClass(qc.status)}`}>
            {qc.displayText || qc.status}
          </span>
        </div>
        {qc.date && (
          <div className="pim-info-item">
            <span className="pim-info-label">Checked On</span>
            <span className="pim-info-value">{qc.date}</span>
          </div>
        )}
        {qc.checkedBy && (
          <div className="pim-info-item">
            <span className="pim-info-label">Checked By</span>
            <span className="pim-info-value">{qc.checkedBy}</span>
          </div>
        )}
        {qc.notes && (
          <div className="pim-info-item" style={{ gridColumn: 'span 2', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span className="pim-info-label">Notes</span>
            <span className="pim-info-value" style={{ whiteSpace: 'pre-wrap', fontSize: '13px', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '4px' }}>
              {qc.notes}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// ✅ NEW: DELIVERY TRACKING CARD
// ============================================
function DeliveryTrackingCard({ order }: any) {
  const delivery = order.deliveryInfo || {};
  
  if (!delivery.expected && !delivery.actual && !delivery.estimatedHours && !delivery.actualHours) return null;

  return (
    <div className="pim-detail-card">
      <h3>
        <i className="fas fa-truck"></i> Delivery & Time Tracking
      </h3>
      <div className="pim-card-content">
        <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '12px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>
            <i className="fas fa-calendar"></i> Delivery Dates
          </h4>
          <div className="pim-info-item">
            <span className="pim-info-label">Expected</span>
            <span className="pim-info-value">{delivery.expectedDate || 'Not set'}</span>
          </div>
          {delivery.expectedTime && (
            <div className="pim-info-item">
              <span className="pim-info-label">Expected Time</span>
              <span className="pim-info-value">{delivery.expectedTime}</span>
            </div>
          )}
          {delivery.actualDate && (
            <div className="pim-info-item">
              <span className="pim-info-label">Actual Delivery</span>
              <span className="pim-info-value">{delivery.actualDate}</span>
            </div>
          )}
          {delivery.actualTime && (
            <div className="pim-info-item">
              <span className="pim-info-label">Actual Time</span>
              <span className="pim-info-value">{delivery.actualTime}</span>
            </div>
          )}
        </div>
        
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>
            <i className="fas fa-hourglass-half"></i> Time Estimates
          </h4>
          <div className="pim-info-item">
            <span className="pim-info-label">Estimated Duration</span>
            <span className="pim-info-value">{delivery.estimatedHours || 'Not set'}</span>
          </div>
          {delivery.actualHours && (
            <div className="pim-info-item">
              <span className="pim-info-label">Actual Duration</span>
              <span className="pim-info-value">{delivery.actualHours}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ROADMAP CARD - Timeline Visualization
// ============================================
function RoadmapCard({ order }: any) {
  if (!order.roadmap || order.roadmap.length === 0) return null;

  const getStepIcon = (stepName: string) => {
    const iconMap: any = {
      "New Request": "fa-plus-circle",
      Inspection: "fa-search",
      Inprogress: "fa-cogs",
      "Quality Check": "fa-check-double",
      Ready: "fa-flag-checkered",
      Completed: "fa-check-circle",
      Cancelled: "fa-ban",
    };
    return iconMap[stepName] || "fa-circle";
  };

  const getStepClass = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "inprogress" || s === "active") return "active";
    if (s === "completed") return "completed";
    return "pending";
  };
  

  // ✅ FIX: better actor resolution to avoid wrong field

  const getStatusLabel = (step: any) => step?.stepStatus || step?.status || "Pending";

  return (
    <div className="pim-roadmap-container jo-roadmap-compact">
      <div className="pim-roadmap-title">
        <i className="fas fa-route"></i>
        Job Order Roadmap
      </div>

      <div className="jo-roadmap-list">
        {order.roadmap.map((step: any, idx: number) => {
          const actor = resolveRoadmapActor(step, order);

          const stepClass = getStepClass(step.status);

          return (
            <div key={idx} className={`jo-roadmap-row ${stepClass}`}>
              <div className="jo-roadmap-row-stage">
                <div className={`jo-roadmap-icon ${stepClass}`}>
                  <i className={`fas ${getStepIcon(step.step)}`}></i>
                </div>
                <div>
                  <div className="jo-roadmap-stage-title">{step.step}</div>
                  <div className={`jo-roadmap-status-chip ${stepClass}`}>{getStatusLabel(step)}</div>
                </div>
              </div>

              <div className="jo-roadmap-row-meta">
                <div className="jo-roadmap-meta-block">
                  <span>Started</span>
                  <strong>{step.startTimestamp || "Not started"}</strong>
                </div>
                <div className="jo-roadmap-meta-block">
                  <span>Completed</span>
                  <strong>{step.endTimestamp || "Not completed"}</strong>
                </div>
                <div className="jo-roadmap-meta-block">
                  <span>Action done by</span>
                  <strong>{actor}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// ORDER TYPE SCREENS
// ============================================
function OrderTypeSelection({ vehicleCompletedServices, onSelectOrderType, onBack, orderType }: any) {
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-list-check"></i>
        <h2>Select Order Type</h2>
      </div>
      <div className="form-card-content">
        <p style={{ marginBottom: "20px", color: "#666", fontSize: "14px" }}>
          This vehicle has {vehicleCompletedServices.length} completed service(s). Choose the type of order you want to create:
        </p>

        <div className="option-selector">
          <div className={`option-btn ${orderType === "new" ? "selected" : ""}`} onClick={() => onSelectOrderType("new")}>
            <i className="fas fa-file-alt" style={{ marginRight: "8px" }}></i>
            New Job Order
          </div>
          <div className={`option-btn ${orderType === "service" ? "selected" : ""}`} onClick={() => onSelectOrderType("service")}>
            <i className="fas fa-tools" style={{ marginRight: "8px" }}></i>
            Service Order
          </div>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left" style={{ marginRight: "8px" }}></i>
          Back
        </button>
      </div>
    </div>
  );
}

function NoCompletedServicesMessage({ onNext, onBack }: any) {
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-info-circle"></i>
        <h2>Order Type</h2>
      </div>
      <div className="form-card-content">
        <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "#fff3cd", borderRadius: "8px", border: "1px solid #ffc107" }}>
          <i className="fas fa-exclamation-circle" style={{ color: "#ff9800", marginRight: "8px" }}></i>
          <span style={{ color: "#ff9800", fontWeight: "500" }}>
            This vehicle has no completed services yet. Proceeding with New Job Order.
          </span>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getWorkStatusClass(status: any) {
  const statusMap: any = {
    "New Request": "status-new-request",
    Inspection: "status-inspection",
    Inprogress: "status-inprogress",
    "Quality Check": "status-quality-check",
    Ready: "status-ready",
    Completed: "status-completed",
    Cancelled: "status-cancelled",
  };
  return statusMap[status] || "status-inprogress";
}

function getPaymentStatusClass(status: any) {
  if (status === "Fully Paid") return "payment-full";
  if (status === "Partially Paid") return "payment-partial";
  return "payment-unpaid";
}

export default JobOrderManagement;