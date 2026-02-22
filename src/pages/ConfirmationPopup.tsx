// src/components/ConfirmationPopup/ConfirmationPopup.tsx
import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import "./ConfirmationPopup.css";

type Tone = "danger" | "primary" | "success";

type Props = {
  open: boolean;
  title?: string;
  message?: React.ReactNode;

  confirmText?: string;
  cancelText?: string;

  tone?: Tone;                // controls confirm button color
  loading?: boolean;          // disable buttons + show spinner
  disableConfirm?: boolean;

  onConfirm: () => void | Promise<void>;
  onCancel: () => void;

  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;

  icon?: React.ReactNode;     // optional custom icon
  footerNote?: React.ReactNode; // optional small note under buttons
};

function getPortalRoot() {
  if (typeof document === "undefined") return null;
  return document.body;
}

export default function ConfirmationPopup({
  open,
  title = "Confirm action",
  message = "Are you sure you want to continue?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger",
  loading = false,
  disableConfirm = false,
  onConfirm,
  onCancel,
  closeOnOverlay = true,
  closeOnEsc = true,
  icon,
  footerNote,
}: Props) {
  const root = useMemo(getPortalRoot, []);
  const canClose = !loading;

  useEffect(() => {
    if (!open || !closeOnEsc) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onCancel();
      if (e.key === "Enter" && !loading && !disableConfirm) onConfirm();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeOnEsc, canClose, onCancel, onConfirm, loading, disableConfirm]);

  if (!open || !root) return null;

  const toneClass =
    tone === "success" ? "cp-btn-success" : tone === "primary" ? "cp-btn-primary" : "cp-btn-danger";

  return createPortal(
    <div
      className="cp-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cp-title"
      onMouseDown={(e) => {
        if (!closeOnOverlay || !canClose) return;
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="cp-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cp-topGlow" aria-hidden="true" />

        <div className="cp-header">
          <div className={`cp-icon ${tone}`}>
            {icon ?? (
              <span className="cp-iconMark" aria-hidden="true">
                !
              </span>
            )}
          </div>

          <div className="cp-headText">
            <div id="cp-title" className="cp-title">
              {title}
            </div>
            <div className="cp-subtitle">{message}</div>
          </div>

          <button
            className="cp-close"
            onClick={() => canClose && onCancel()}
            aria-label="Close"
            disabled={!canClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="cp-actions">
          <button className="cp-btn cp-btn-ghost" onClick={onCancel} disabled={!canClose} type="button">
            {cancelText}
          </button>

          <button
            className={`cp-btn ${toneClass}`}
            onClick={() => !loading && !disableConfirm && onConfirm()}
            disabled={loading || disableConfirm}
            type="button"
          >
            {loading ? (
              <span className="cp-loading">
                <span className="cp-spinner" aria-hidden="true" />
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>

        {footerNote ? <div className="cp-footnote">{footerNote}</div> : null}
      </div>
    </div>,
    root
  );
}