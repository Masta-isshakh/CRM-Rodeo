/* src/pages/joborders/SuccessPopup.tsx */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PopupModal.css";

type Props = {
  isVisible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  message: React.ReactNode; // ✅ supports fragments
  autoCloseMs?: number; // optional
  closeText?: string; // button text
  hideButton?: boolean; // if you want message-only
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

export default function SuccessPopup({
  isVisible,
  onClose,
  title = "Success",
  subtitle,
  message,
  autoCloseMs,
  closeText = "Close",
  hideButton = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [animateOpen, setAnimateOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const portalTarget = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  useBodyScrollLock(isVisible);

  // mount + open animation
  useEffect(() => {
    if (!isVisible) {
      setAnimateOpen(false);
      return;
    }
    setMounted(true);
    const t = window.setTimeout(() => setAnimateOpen(true), 10);
    return () => window.clearTimeout(t);
  }, [isVisible]);

  // focus + ESC close
  useEffect(() => {
    if (!isVisible) return;

    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isVisible, onClose]);

  // auto close
  useEffect(() => {
    if (!isVisible) return;
    if (!autoCloseMs || autoCloseMs <= 0) return;
    const t = window.setTimeout(() => onClose(), autoCloseMs);
    return () => window.clearTimeout(t);
  }, [isVisible, autoCloseMs, onClose]);

  // allow exit animation before unmount
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
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        // close when clicking outside the modal
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`popup-modal popup-success ${animateOpen ? "popup-open" : ""}`}>
        <div className="popup-header">
          <div className="popup-icon" aria-hidden="true">
            <i className="fas fa-check-circle" />
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
        </div>

        {!hideButton && (
          <div className="popup-actions">
            <button ref={closeBtnRef} className="popup-btn primary" onClick={onClose}>
              {closeText}
            </button>
          </div>
        )}
      </div>
    </div>,
    portalTarget
  );
}