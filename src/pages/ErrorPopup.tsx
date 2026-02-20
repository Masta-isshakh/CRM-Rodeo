/* src/pages/joborders/ErrorPopup.tsx */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PopupModal.css";

type Props = {
  isVisible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  message: React.ReactNode; // ✅ supports string or JSX
  details?: string; // optional extra details (stack trace / debug)
  autoCloseMs?: number; // optional
  closeText?: string;
  retryText?: string;
  onRetry?: () => void; // optional retry action
};

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

export default function ErrorPopup({
  isVisible,
  onClose,
  title = "Something went wrong",
  subtitle,
  message,
  details,
  autoCloseMs,
  closeText = "Close",
  retryText = "Retry",
  onRetry,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [animateOpen, setAnimateOpen] = useState(false);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);

  const portalTarget = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  useBodyScrollLock(isVisible);

  useEffect(() => {
    if (!isVisible) {
      setAnimateOpen(false);
      return;
    }
    setMounted(true);
    const t = window.setTimeout(() => setAnimateOpen(true), 10);
    return () => window.clearTimeout(t);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const t = window.setTimeout(() => primaryBtnRef.current?.focus(), 50);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && onRetry) onRetry();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isVisible, onClose, onRetry]);

  useEffect(() => {
    if (!isVisible) return;
    if (!autoCloseMs || autoCloseMs <= 0) return;
    const t = window.setTimeout(() => onClose(), autoCloseMs);
    return () => window.clearTimeout(t);
  }, [isVisible, autoCloseMs, onClose]);

  useEffect(() => {
    if (isVisible) return;
    if (!mounted) return;

    const t = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(t);
  }, [isVisible, mounted]);

  if (!mounted || !portalTarget) return null;

  return createPortal(
    <div
      className="popup-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`popup-modal popup-error ${animateOpen ? "popup-open" : ""}`}>
        <div className="popup-header">
          <div className="popup-icon" aria-hidden="true">
            <i className="fas fa-exclamation-triangle" />
          </div>

          <div className="popup-title-wrap">
            <h3 className="popup-title">{title}</h3>
            {subtitle ? <p className="popup-subtitle">{subtitle}</p> : null}
          </div>

          <button className="popup-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="popup-body">
          <div className="popup-message">{message}</div>

          {details ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 6 }}>Details</div>
              <pre
                style={{
                  margin: 0,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(0,0,0,0.04)",
                  overflow: "auto",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {details}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="popup-actions">
          <button className="popup-btn ghost" onClick={onClose}>
            {closeText}
          </button>
          {onRetry ? (
            <button ref={primaryBtnRef} className="popup-btn primary" onClick={onRetry}>
              {retryText}
            </button>
          ) : (
            <button ref={primaryBtnRef} className="popup-btn primary" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>,
    portalTarget
  );
}