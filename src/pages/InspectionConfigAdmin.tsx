// src/pages/inspection/InspectionConfigAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import SuccessPopup from "./SuccessPopup";
import PermissionGate from "./PermissionGate";

import * as inspectionConfigModule from "./inspectionConfig";
const fallbackConfig: any[] =
  (inspectionConfigModule as any).default ??
  (inspectionConfigModule as any).inspectionListConfig ??
  [];

import {
  getActiveInspectionConfigRecord,
  saveInspectionConfigToBackend,
  loadInspectionConfig,
} from "./inspectionRepo";
import { normalizeActorIdentity } from "../utils/actorIdentity";

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

export default function InspectionConfigAdmin({ currentUser }: any) {
  const actor = useMemo(() => currentUser?.name || currentUser?.email || "admin", [currentUser]);

  const [loading, setLoading] = useState(false);
  const [recordMeta, setRecordMeta] = useState<any | null>(null);

  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState<ReactNode>("");

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await loadInspectionConfig(fallbackConfig);
      setText(JSON.stringify(cfg, null, 2));
      setParseError(null);

      const rec = await getActiveInspectionConfigRecord("default");
      setRecordMeta(rec || null);
    } catch (e) {
      console.error(e);
      setPopupMessage(`Load failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = () => {
    try {
      JSON.parse(text);
      setParseError(null);
      setPopupMessage("JSON is valid ✅");
      setShowPopup(true);
    } catch (e: any) {
      setParseError(String(e?.message ?? e));
    }
  };

  const save = async () => {
    setLoading(true);
    try {
      const obj = JSON.parse(text);

      await saveInspectionConfigToBackend({
        configKey: "default",
        configObject: obj,
        actor,
      });

      const rec = await getActiveInspectionConfigRecord("default");
      setRecordMeta(rec || null);

      setPopupMessage(
        <>
          <div style={{ fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>
            <i className="fas fa-check-circle"></i> Config saved successfully
          </div>
          <div>Key: <strong>default</strong></div>
          <div>Version: <strong>{rec?.version ?? "?"}</strong></div>
        </>
      );
      setShowPopup(true);
      setParseError(null);
    } catch (e) {
      console.error(e);
      setPopupMessage(`Save failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PermissionGate moduleId="admin" optionId="inspection_config_admin">
      <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>
            <i className="fas fa-tools"></i> Inspection Config Admin
          </h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              <i className="fas fa-sync"></i> {loading ? "Loading..." : "Reload"}
            </button>
            <button className="btn btn-primary" onClick={validate} disabled={loading}>
              <i className="fas fa-check"></i> Validate JSON
            </button>
            <button className="btn btn-success" onClick={() => void save()} disabled={loading}>
              <i className="fas fa-save"></i> {loading ? "Saving..." : "Save to Backend"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 10, color: "#555" }}>
          <div>
            Active record:{" "}
            <strong>{recordMeta?.id ? `v${recordMeta.version ?? "?"}` : "Not found (will create on save)"}</strong>
          </div>
          <div>Updated By: <strong>{normalizeActorIdentity(recordMeta?.updatedBy) || "-"}</strong> • Updated At: <strong>{recordMeta?.updatedAt ?? "-"}</strong></div>
        </div>

        {parseError && (
          <div style={{ padding: 12, background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 8, color: "#9f1239", marginBottom: 12 }}>
            <strong>JSON Error:</strong> {parseError}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 600,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 13,
            padding: 14,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            outline: "none",
          }}
        />

        {showPopup && (
          <SuccessPopup
            isVisible={true}
            onClose={() => setShowPopup(false)}
            message={popupMessage}
          />
        )}
      </div>
    </PermissionGate>
  );
}