import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Authenticator, ThemeProvider, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { getCurrentUser, signIn } from "aws-amplify/auth";
import SetPasswordPage from "./pages/SetPassword";
import { getDataClient } from "./lib/amplifyClient";
import appLogo from "./assets/logo.jpeg";
import { LANGUAGE_STORAGE_KEY, translateTextValue, type LanguageCode } from "./i18n/translations";
import { GlobalLoadingProvider } from "./utils/GlobalLoadingContext";
import "./App.css";

const MainLayout = lazy(() => import("./components/MainLayout"));

const ACCOUNT_BLOCK_MESSAGE_KEY = "crm.accountBlockMessage";
const FAILED_LOGIN_TRACKER_KEY = "crm.failedLoginTracker";
const FAILED_LOGIN_THRESHOLD = 5;
const FAILED_LOGIN_LOCK_MINUTES = 15;
const SIGNIN_TIMEOUT_MS = 30000; // 30 seconds for sign in request
const SESSION_CHECK_TIMEOUT_DEFAULT_MS = 15000;
const SESSION_CHECK_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_SESSION_CHECK_TIMEOUT_MS ?? SESSION_CHECK_TIMEOUT_DEFAULT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : SESSION_CHECK_TIMEOUT_DEFAULT_MS;
})();
const SESSION_DEBUG_LOCAL_STORAGE_KEY = "crm.debugSessionCheck";
const SESSION_CACHE_KEY = "crm.sessionOk";
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const SESSION_EXPIRES_AT_KEY = "crm.sessionExpiresAt";

type FailedLoginTracker = Record<string, { count: number; lockedUntil: number }>;

function withTimeout<T>(label: string, operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation()
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function resolveUiLanguage(): LanguageCode {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // ignore storage access issues
  }
  return "en";
}

function tr(englishText: string): string {
  return translateTextValue(englishText, resolveUiLanguage());
}

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { hasError: boolean; message: string };

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unknown runtime error",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Keep diagnostics in console for local troubleshooting.
    console.error("[app-error-boundary]", error, info);
  }

  private resetBoundary = () => {
    this.setState({ hasError: false, message: "" });
  };

  private hardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "#0f172a",
            color: "#f8fafc",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "640px",
              border: "1px solid rgba(248,250,252,0.25)",
              borderRadius: "14px",
              padding: "20px",
              background: "rgba(15,23,42,0.82)",
              boxShadow: "0 10px 24px rgba(2,6,23,0.45)",
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "1.2rem", fontWeight: 700 }}>
              Application Error
            </h2>
            <p style={{ margin: "0 0 10px", opacity: 0.9 }}>
              A runtime error interrupted rendering. You can retry without reloading first.
            </p>
            <p style={{ margin: "0 0 14px", fontSize: "0.9rem", opacity: 0.85 }}>
              {this.state.message || "Unknown runtime error"}
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={this.resetBoundary}
                style={{
                  borderRadius: "8px",
                  border: "1px solid rgba(248,250,252,0.35)",
                  background: "#1d4ed8",
                  color: "#fff",
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Retry Render
              </button>
              <button
                type="button"
                onClick={this.hardReload}
                style={{
                  borderRadius: "8px",
                  border: "1px solid rgba(248,250,252,0.35)",
                  background: "transparent",
                  color: "#fff",
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const crmAuthTheme = {
  name: "crm-auth-theme",
  tokens: {
    colors: {
      font: {
        primary: { value: "#f8fafc" },
        secondary: { value: "#e5e7eb" },
      },
      background: {
        primary: { value: "transparent" },
        secondary: { value: "transparent" },
      },
      border: {
        primary: { value: "rgba(255, 255, 255, 0.42)" },
      },
      brand: {
        primary: {
          10: "#ffffff",
          80: "#ffffff",
          90: "#ffffff",
          100: "#ffffff",
        },
      },
    },
    radii: {
      small: { value: "14px" },
      medium: { value: "15px" },
      large: { value: "15px" },
    },
    components: {
      authenticator: {
        router: {
          backgroundColor: { value: "rgba(4, 7, 20, 0.26)" },
          borderColor: { value: "rgba(255, 255, 255, 0.28)" },
          borderWidth: { value: "1px" },
          borderStyle: { value: "solid" },
          borderRadius: { value: "15px" },
          backdropFilter: { value: "blur(16px)" },
          webkitBackdropFilter: { value: "blur(16px)" },
          overflow: { value: "hidden" },
          boxShadow: { value: "none" },
        },
      },
      card: {
        backgroundColor: { value: "rgba(6, 10, 24, 0.66)" },
        borderRadius: { value: "28px" },
      },
      button: {
        primary: {
          backgroundColor: { value: "#ffffff" },
          color: { value: "#111827" },
          _hover: { backgroundColor: { value: "#f3f4f6" } },
          _focus: { backgroundColor: { value: "#f9fafb" } },
        },
      },
      fieldcontrol: {
        backgroundColor: { value: "rgba(255, 255, 255, 0.07)" },
        borderColor: { value: "rgba(255, 255, 255, 0.55)" },
        borderRadius: { value: "14px" },
        color: { value: "#ffffff" },
        _focus: {
          borderColor: { value: "rgba(255, 255, 255, 0.85)" },
          boxShadow: { value: "none" },
        },
      },
    },
  },
};

const authComponents = {
  SignIn: {
    Header() {
      return (
        <div className="crm-auth-signin-head">
          <img src={appLogo} alt={tr("CRM Logo")} className="crm-auth-logo" />
          <h1>{tr("Login")}</h1>
        </div>
      );
    },
    Footer() {
      const { toForgotPassword } = useAuthenticator();
      return (
        <div className="crm-auth-forgot-under-row">
          <button type="button" className="crm-auth-forgot-link" onClick={toForgotPassword}>
            {tr("Forgot Password?")}
          </button>
        </div>
      );
    },
  },
  ForgotPassword: {
    Header() {
      return (
        <div className="crm-auth-signin-head">
          <img src={appLogo} alt={tr("CRM Logo")} className="crm-auth-logo" />
          <h1>{tr("Reset Password")}</h1>
        </div>
      );
    },
  },
  ConfirmResetPassword: {
    Header() {
      return (
        <div className="crm-auth-signin-head">
          <img src={appLogo} alt={tr("CRM Logo")} className="crm-auth-logo" />
          <h1>{tr("Confirm New Password")}</h1>
        </div>
      );
    },
  },
};

export default function App() {
  const [blockedMessage, setBlockedMessage] = useState("");
  const path = window.location.pathname;

  useEffect(() => {
    try {
      const msg = window.localStorage.getItem(ACCOUNT_BLOCK_MESSAGE_KEY) ?? "";
      if (msg) setBlockedMessage(msg);
    } catch {
      // ignore
    }
  }, []);

  // ✅ Enhance login form: style Amplify's password toggle button with premium design
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const passwordToggle = document.querySelector('.amplify-field__show-password') as HTMLButtonElement | null;
      if (passwordToggle) {
        passwordToggle.className = 'crm-auth-password-toggle';
        const hiddenText = passwordToggle.querySelector('.amplify-visually-hidden') as HTMLElement | null;
        if (hiddenText) hiddenText.style.display = 'none';
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, []);

  const setBlocked = (message: string) => {
    const next = String(message ?? "").trim();
    setBlockedMessage(next);
    try {
      if (next) window.localStorage.setItem(ACCOUNT_BLOCK_MESSAGE_KEY, next);
      else window.localStorage.removeItem(ACCOUNT_BLOCK_MESSAGE_KEY);
    } catch {
      // ignore
    }
  };

  const authServices = {
    async handleSignIn(input: any) {
      const rawUsername = String(input?.username ?? input?.email ?? "").trim().toLowerCase();
      const emailKey = rawUsername;

      let tracker: FailedLoginTracker = {};
      try {
        tracker = JSON.parse(window.localStorage.getItem(FAILED_LOGIN_TRACKER_KEY) ?? "{}") as FailedLoginTracker;
      } catch {
        tracker = {};
      }

      const entry = tracker[emailKey] ?? { count: 0, lockedUntil: 0 };
      const now = Date.now();

      if (entry.lockedUntil > now) {
        const waitMinutes = Math.ceil((entry.lockedUntil - now) / 60000);
        throw new Error(`Too many failed attempts. Try again in ${waitMinutes} minute(s).`);
      }

      try {
        const res = await withTimeout(
          "Sign In",
          () =>
            signIn({
              username: input?.username,
              password: input?.password,
            }),
          SIGNIN_TIMEOUT_MS
        );

        if (emailKey) {
          delete tracker[emailKey];
          window.localStorage.setItem(FAILED_LOGIN_TRACKER_KEY, JSON.stringify(tracker));
        }
        return res;
      } catch (error) {
        if (emailKey) {
          const nextCount = Number(entry.count ?? 0) + 1;
          const lockedUntil =
            nextCount >= FAILED_LOGIN_THRESHOLD
              ? now + FAILED_LOGIN_LOCK_MINUTES * 60 * 1000
              : 0;

          tracker[emailKey] = { count: nextCount, lockedUntil };
          window.localStorage.setItem(FAILED_LOGIN_TRACKER_KEY, JSON.stringify(tracker));

          if (lockedUntil) {
            setBlocked(
              `This account is temporarily blocked in this application after ${FAILED_LOGIN_THRESHOLD} failed login attempts. Try again in ${FAILED_LOGIN_LOCK_MINUTES} minutes or contact an administrator.`
            );
          }
        }
        throw error;
      }
    },
  };

  // ✅ allow public set-password route
  if (path.startsWith("/set-password")) {
    return (
      <AppErrorBoundary>
        <SetPasswordPage />
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <GlobalLoadingProvider>
        {blockedMessage && (
          <div className="crm-auth-block-banner" role="alert">
            <span>{blockedMessage}</span>
            <button type="button" onClick={() => setBlocked("")}>{tr("Dismiss")}</button>
          </div>
        )}
        <ThemeProvider theme={crmAuthTheme as any}>
          <Authenticator 
            hideSignUp 
            services={authServices} 
            className="crm-authenticator" 
            components={authComponents}
          >
            {() => <AppContent onBlocked={setBlocked} />}
          </Authenticator>
        </ThemeProvider>
      </GlobalLoadingProvider>
    </AppErrorBoundary>
  );
}

function AppContent({ onBlocked }: { onBlocked: (message: string) => void }) {
  const client = useMemo(() => getDataClient(), []);
  const { signOut } = useAuthenticator((context) => [context.user]);
    const [sessionChecked, setSessionChecked] = useState(() => {
      try {
        const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number };
          if (Date.now() - parsed.at < SESSION_CACHE_TTL_MS) return true;
        }
      } catch {
        // ignore storage errors
      }
      return false;
    });

  const safeSignOut = () => {
    try {
      window.localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
      window.sessionStorage.removeItem(SESSION_CACHE_KEY);
    } catch {
      // ignore storage errors
    }

    try {
      signOut?.();
    } catch {
      // ignore sign-out failures and continue rendering
    }
  };

  useEffect(() => {
    let timeoutId: number | null = null;
    let intervalId: number | null = null;

    const readExpiry = () => {
      try {
        const raw = window.localStorage.getItem(SESSION_EXPIRES_AT_KEY);
        const parsed = Number(raw ?? "");
        return Number.isFinite(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };

    const writeExpiry = (value: number) => {
      try {
        window.localStorage.setItem(SESSION_EXPIRES_AT_KEY, String(value));
      } catch {
        // ignore storage errors
      }
    };

    const clearScheduled = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const expireNow = () => {
      onBlocked(tr("Your session expired after 1 hour. Please sign in again."));
      safeSignOut();
    };

    const ensureExpiry = () => {
      const now = Date.now();
      const existing = readExpiry();
      const expiresAt = existing && existing > 0 ? existing : now + SESSION_EXPIRY_MS;

      if (!existing) writeExpiry(expiresAt);

      const remainingMs = expiresAt - now;
      clearScheduled();

      if (remainingMs <= 0) {
        expireNow();
        return;
      }

      timeoutId = window.setTimeout(() => {
        expireNow();
      }, remainingMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") ensureExpiry();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_EXPIRES_AT_KEY) return;
      const next = Number(event.newValue ?? "");
      if (!Number.isFinite(next) || next <= Date.now()) {
        expireNow();
        return;
      }
      ensureExpiry();
    };

    ensureExpiry();
    intervalId = window.setInterval(ensureExpiry, 60 * 1000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    return () => {
      clearScheduled();
      if (intervalId != null) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [onBlocked, signOut]);

  useEffect(() => {
    let cancelled = false;
    const debugEnabled =
      import.meta.env.DEV ||
      import.meta.env.VITE_DEBUG_SESSION_CHECK === "true" ||
      window.localStorage.getItem(SESSION_DEBUG_LOCAL_STORAGE_KEY) === "true";
    const debugLog = (...args: unknown[]) => {
      if (debugEnabled) console.info("[session-check]", ...args);
    };

    (async () => {
      try {
        debugLog("Starting session verification", { timeoutMs: SESSION_CHECK_TIMEOUT_MS });

        const user = await withTimeout("getCurrentUser", () => getCurrentUser(), SESSION_CHECK_TIMEOUT_MS);
        const email = String(user?.signInDetails?.loginId ?? user?.username ?? "").trim().toLowerCase();
        debugLog("User resolved", { hasEmail: Boolean(email) });
        if (!email) return;

        const res = await withTimeout(
          "UserProfile.list",
          () =>
            client.models.UserProfile.list({
            filter: { email: { eq: email } },
            limit: 1,
            } as any),
          SESSION_CHECK_TIMEOUT_MS
        );
        const row = (res?.data ?? [])[0] as any;
        if (!row) return;

        const isActive = Boolean(row?.isActive ?? true);
        const dashboardAccessEnabled = Boolean(row?.dashboardAccessEnabled ?? true);

        if (!isActive || !dashboardAccessEnabled) {
          onBlocked(
            !isActive
              ? "Your account is inactive. Please contact your administrator."
              : "Your dashboard access is disabled. Please contact your administrator."
          );
          safeSignOut();
          return;
        }

        onBlocked("");
      } catch (error) {
        debugLog("Session verification failed", error);
          // Only block the user if we don't already have a recent cached OK (avoid false-positives on network flakes)
          try {
            const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
            const cached = raw ? (JSON.parse(raw) as { at: number }) : null;
            if (!cached || Date.now() - cached.at >= SESSION_CACHE_TTL_MS) {
              onBlocked("We could not verify your session. Please sign in again.");
              safeSignOut();
            }
          } catch {
            onBlocked("We could not verify your session. Please sign in again.");
            safeSignOut();
          }
      } finally {
        debugLog("Session verification completed");
        if (!cancelled) setSessionChecked(true);
      }
            try {
              window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ at: Date.now() }));
            } catch {
              // ignore storage errors
            }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, onBlocked, signOut]);

  if (!sessionChecked) {
    return (
      <div className="crm-auth-loading" role="status" aria-live="polite">
        {tr("Checking your session...")}
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="crm-auth-loading" role="status" aria-live="polite">
          {tr("Loading workspace...")}
        </div>
      }
    >
      <MainLayout signOut={safeSignOut} />
    </Suspense>
  );
}
