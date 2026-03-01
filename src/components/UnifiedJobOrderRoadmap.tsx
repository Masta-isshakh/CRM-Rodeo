import "../pages/JobCards.css";

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

function toUsernameDisplay(v: any) {
  const raw = joStr(v);
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  const at = normalized.indexOf("@");
  if (at > 0) return normalized.slice(0, at);
  return normalized;
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
    t === "unknown" ||
    t === "inspector" ||
    t === "qc inspector"
  );
}

function resolveCreatedBy(order: any) {
  const summary = order?.jobOrderSummary ?? {};

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

  if (joIsPlaceholderName(primary)) {
    const alt = joFirst(order?.createdByDisplay, order?.createdByEmail, order?.creatorName, order?.createdUserName);
    return alt && !joIsPlaceholderName(alt) ? toUsernameDisplay(alt) : toUsernameDisplay(primary || "—");
  }

  return toUsernameDisplay(primary || "—");
}

function resolveRoadmapActor(step: any, order: any) {
  const stepName = joStr(step?.step).toLowerCase();
  const isNewRequestStep = stepName === "new request" || stepName === "newrequest";

  const actor = joFirst(
    step?.actionByName,
    step?.actionBy,
    step?.performedBy,
    step?.doneBy,
    step?.updatedByName,
    step?.updatedBy,
    step?.createdByName,
    step?.createdBy,
    step?.technicianName,
    step?.technician,
    isNewRequestStep ? resolveCreatedBy(order) : ""
  );

  return joIsPlaceholderName(actor) ? "" : toUsernameDisplay(actor);
}

function normalizeStepName(name: any) {
  return String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function getStepIcon(stepName: string) {
  const iconMap: any = {
    "New Request": "fa-plus-circle",
    Inspection: "fa-search",
    Service_Operation: "fa-cogs",
    Inprogress: "fa-cogs",
    "Quality Check": "fa-check-double",
    Ready: "fa-flag-checkered",
    Completed: "fa-check-circle",
    Cancelled: "fa-ban",
  };
  return iconMap[stepName] || "fa-circle";
}

function getStepClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "inprogress" || s === "active") return "active";
  if (s === "completed") return "completed";
  return "pending";
}

export default function UnifiedJobOrderRoadmap({ order }: { order: any }) {
  if (!order?.roadmap || order.roadmap.length === 0) return null;

  const roadmap = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const normalizedWorkStatus = normalizeStepName(order?.workStatus ?? order?.workStatusLabel);
  const progressedToInspectionOrBeyond = new Set([
    "inspection",
    "inprogress",
    "serviceoperation",
    "qualitycheck",
    "ready",
    "completed",
    "cancelled",
  ]).has(normalizedWorkStatus);

  const findStep = (name: string) => roadmap.find((s: any) => normalizeStepName(s?.step) === normalizeStepName(name));
  const findStartedAt = (s: any) => joFirst(s?.startTimestamp, s?.startedAt, s?.startTime, s?.started);
  const findCompletedAt = (s: any) => joFirst(s?.endTimestamp, s?.completedAt, s?.endTime, s?.ended);

  const newRequestStep = findStep("New Request");
  const inspectionStep = findStep("Inspection");
  const newRequestCompletedRaw = findCompletedAt(newRequestStep);
  const inspectionStartedRaw = findStartedAt(inspectionStep);

  const inspectionIndex = roadmap.findIndex((s: any) => normalizeStepName(s?.step) === "inspection");
  const firstLaterStartedAt =
    inspectionIndex >= 0
      ? roadmap.slice(inspectionIndex + 1).map((s: any) => findStartedAt(s)).find((v: string) => !!joStr(v))
      : "";

  const inferredInspectionStartedAt =
    inspectionStartedRaw ||
    newRequestCompletedRaw ||
    firstLaterStartedAt ||
    (progressedToInspectionOrBeyond ? joFirst(order?.updatedAt, order?.lastUpdatedAt) : "");

  const getStatusLabel = (step: any) => step?.stepStatus || step?.status || "Pending";

  return (
    <div className="pim-roadmap-container jo-roadmap-compact">
      <div className="pim-roadmap-title">
        <i className="fas fa-route"></i>
        Job Order Roadmap
      </div>

      <div className="jo-roadmap-list">
        {roadmap.map((step: any, idx: number) => {
          const actorFromStep = resolveRoadmapActor(step, order);
          const stepName = normalizeStepName(step?.step);
          const stepLabel = stepName === "inprogress" || stepName === "serviceoperation" ? "Service_Operation" : step?.step;
          const nextStep = roadmap[idx + 1];
          const stepStartedAt = findStartedAt(step);
          const stepCompletedAt = findCompletedAt(step);
          const normalizedStepStatus = normalizeStepName(step?.stepStatus || step?.status);

          const inferredStartedAt = stepName === "inspection" ? stepStartedAt || inferredInspectionStartedAt : stepStartedAt;

          const inferredCompletedAt =
            stepName === "newrequest"
              ? stepCompletedAt || inferredInspectionStartedAt || findStartedAt(nextStep)
              : stepCompletedAt;

          const stepHasProgress =
            !!joStr(inferredStartedAt) ||
            !!joStr(inferredCompletedAt) ||
            normalizedStepStatus === "active" ||
            normalizedStepStatus === "inprogress" ||
            normalizedStepStatus === "completed";

          const fallbackActor = joFirst(step?.updatedByName, step?.updatedBy, order?.updatedByName, order?.updatedBy);
          const actor = stepHasProgress ? (actorFromStep || (fallbackActor.includes("@") ? fallbackActor : "")) : "";
          const completedLabel = inferredCompletedAt || "Not completed";

          const stepClass = getStepClass(step?.stepStatus || step?.status);

          return (
            <div key={idx} className={`jo-roadmap-row ${stepClass}`}>
              <div className="jo-roadmap-row-stage">
                <div className={`jo-roadmap-icon ${stepClass}`}>
                  <i className={`fas ${getStepIcon(step.step)}`}></i>
                </div>
                <div>
                  <div className="jo-roadmap-stage-title">{stepLabel}</div>
                  <div className={`jo-roadmap-status-chip ${stepClass}`}>{getStatusLabel(step)}</div>
                </div>
              </div>

              <div className="jo-roadmap-row-meta">
                <div className="jo-roadmap-meta-block">
                  <span>Started</span>
                  <strong>{inferredStartedAt || "Not started"}</strong>
                </div>
                <div className="jo-roadmap-meta-block">
                  <span>Completed</span>
                  <strong>{completedLabel}</strong>
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
