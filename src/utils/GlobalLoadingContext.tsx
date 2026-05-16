/**
 * GlobalLoadingContext
 *
 * Provides a centralized, app-wide loading overlay so any page or action
 * can show a consistent full-screen spinner without each component
 * managing its own overlay.
 *
 * Usage:
 *   const { showLoading, hideLoading, withLoading } = useGlobalLoading();
 *
 *   // Wrap any async call:
 *   await withLoading(someAsyncFn(), "Saving changes…");
 *
 *   // Or manually:
 *   showLoading("Uploading file…");
 *   try { … } finally { hideLoading(); }
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface LoadingState {
  active: boolean;
  message: string;
}

interface GlobalLoadingContextValue {
  showLoading: (message?: string) => void;
  hideLoading: () => void;
  /** Wraps a promise: shows overlay while it is pending, hides when done. */
  withLoading: <T>(promise: Promise<T>, message?: string) => Promise<T>;
  isLoading: boolean;
}

/* ─── Context ────────────────────────────────────────────────────────────── */
const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

/* ─── Provider ───────────────────────────────────────────────────────────── */
export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadingState>({ active: false, message: "" });
  // depth counter so nested calls don't hide prematurely
  const depthRef = useRef(0);

  const showLoading = useCallback((message = "Loading…") => {
    depthRef.current += 1;
    setState({ active: true, message });
  }, []);

  const hideLoading = useCallback(() => {
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) {
      setState({ active: false, message: "" });
    }
  }, []);

  const withLoading = useCallback(
    async <T,>(promise: Promise<T>, message = "Loading…"): Promise<T> => {
      showLoading(message);
      try {
        return await promise;
      } finally {
        hideLoading();
      }
    },
    [showLoading, hideLoading]
  );

  return (
    <GlobalLoadingContext.Provider
      value={{ showLoading, hideLoading, withLoading, isLoading: state.active }}
    >
      {children}
      {state.active && <GlobalLoadingOverlay message={state.message} />}
    </GlobalLoadingContext.Provider>
  );
}

/* ─── Hook ────────────────────────────────────────────────────────────────── */
export function useGlobalLoading(): GlobalLoadingContextValue {
  const ctx = useContext(GlobalLoadingContext);
  if (!ctx) {
    throw new Error("useGlobalLoading must be used inside <GlobalLoadingProvider>");
  }
  return ctx;
}

/* ─── Overlay UI ─────────────────────────────────────────────────────────── */
function GlobalLoadingOverlay({ message }: { message: string }) {
  return (
    <>
      <style>{overlayCSS}</style>
      <div className="glb-loading-backdrop" role="status" aria-live="polite">
        <div className="glb-loading-card">
          <div className="glb-spinner" aria-hidden="true">
            <div className="glb-spinner-ring" />
          </div>
          {message && <p className="glb-loading-msg">{message}</p>}
        </div>
      </div>
    </>
  );
}

/* ─── Inline CSS (no extra file needed) ──────────────────────────────────── */
const overlayCSS = `
.glb-loading-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(7, 10, 18, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: glbFadeIn 0.18s ease;
}

@keyframes glbFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.glb-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 20px;
  padding: 32px 40px;
  box-shadow: 0 24px 60px rgba(2, 6, 23, 0.32);
  min-width: 160px;
}

@media (max-width: 480px) {
  .glb-loading-card {
    padding: 24px 28px;
    min-width: 130px;
  }
}

.glb-spinner {
  width: 48px;
  height: 48px;
  position: relative;
}

.glb-spinner-ring {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 50%;
  border: 4px solid rgba(47, 125, 225, 0.18);
  border-top-color: #2f7de1;
  border-right-color: #1f66c2;
  transform-origin: 50% 50%;
  will-change: transform;
  animation: glbSpin 0.75s linear infinite !important;
}

@keyframes glbSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.glb-loading-msg {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0b1224;
  text-align: center;
  max-width: 200px;
  line-height: 1.4;
}
`;
