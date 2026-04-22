import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Authenticator, ThemeProvider, useAuthenticator, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { getCurrentUser, signIn } from "aws-amplify/auth";
import MainLayout from "./components/MainLayout";
import SetPasswordPage from "./pages/SetPassword";
import { getDataClient } from "./lib/amplifyClient";
import appLogo from "./assets/logo.jpeg";
import { LANGUAGE_STORAGE_KEY, translateTextValue, type LanguageCode } from "./i18n/translations";
import "./App.css";

const ACCOUNT_BLOCK_MESSAGE_KEY = "crm.accountBlockMessage";
const FAILED_LOGIN_TRACKER_KEY = "crm.failedLoginTracker";
const FAILED_LOGIN_THRESHOLD = 5;
const FAILED_LOGIN_LOCK_MINUTES = 15;
const SESSION_CHECK_TIMEOUT_DEFAULT_MS = 15000;
const SESSION_CHECK_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_SESSION_CHECK_TIMEOUT_MS ?? SESSION_CHECK_TIMEOUT_DEFAULT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : SESSION_CHECK_TIMEOUT_DEFAULT_MS;
})();
const SESSION_DEBUG_LOCAL_STORAGE_KEY = "crm.debugSessionCheck";
const SESSION_CACHE_KEY = "crm.sessionOk";
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
    FormFields() {
      const [password, setPassword] = useState("");
      const [showPassword, setShowPassword] = useState(false);

      const PasswordVisibilityIcon = ({ visible }: { visible: boolean }) => {
        if (visible) {
          return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 3L21 21"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10.58 10.58a2 2 0 102.84 2.84"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.88 4.24A10.94 10.94 0 0112 4c5.52 0 10 4.48 10 8a7.87 7.87 0 01-2.04 4.95M6.1 6.1A11.4 11.4 0 002 12c0 3.52 4.48 8 10 8a11.4 11.4 0 005.9-1.9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          );
        }

        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        );
      };

      const rules = [
        {
            label: tr("At least 8 characters"),
          valid: password.length >= 8,
        },
        {
            label: tr("At least 1 uppercase letter"),
          valid: /[A-Z]/.test(password),
        },
        {
            label: tr("At least 1 lowercase letter"),
          valid: /[a-z]/.test(password),
        },
        {
            label: tr("At least 1 number"),
          valid: /\d/.test(password),
        },
        {
            label: tr("At least 1 special character"),
          valid: /[^A-Za-z0-9]/.test(password),
        },
      ];
      const allRulesMet = rules.every((rule) => rule.valid);

      return (
        <div>
          <TextField
            name="username"
            type="email"
            autoComplete="username"
              label={tr("Email")}
            placeholder={tr("Enter your email")}
            required
          />

          <div className="amplify-field crm-auth-password-field">
            <label className="amplify-label" htmlFor="crm-login-password">{tr("Password")}</label>
            <div className="crm-auth-password-input-wrap">
              <input
                id="crm-login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="amplify-input"
                placeholder={tr("Enter your password")}
                onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                required
              />
              <button
                type="button"
                className="crm-auth-password-toggle"
                aria-label={showPassword ? tr("Hide password") : tr("Show password")}
                title={showPassword ? tr("Hide password") : tr("Show password")}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                <PasswordVisibilityIcon visible={showPassword} />
              </button>
            </div>
          </div>

          {!allRulesMet && (
            <div className="crm-auth-password-rules" aria-live="polite">
                <div className="crm-auth-password-rules-title">{tr("Password requirements")}</div>
              <ul>
                {rules.map((rule) => (
                  <li key={rule.label} className={rule.valid ? "met" : "unmet"}>
                    <span className="rule-dot" aria-hidden="true" />
                    <span>{rule.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="crm-auth-meta-row" aria-hidden="true">
            <label className="crm-auth-remember">
              <input type="checkbox" />
              <span>{tr("Remember me")}</span>
            </label>
            <span className="crm-auth-forgot-text">{tr("Forgot Password?")}</span>
          </div>
        </div>
      );
    },
    Footer() {
      return null;
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
        const res = await signIn({
          username: input?.username,
          password: input?.password,
        });

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
      {blockedMessage && (
        <div className="crm-auth-block-banner" role="alert">
          <span>{blockedMessage}</span>
          <button type="button" onClick={() => setBlocked("")}>{tr("Dismiss")}</button>
        </div>
      )}
      <ThemeProvider theme={crmAuthTheme as any}>
        <Authenticator hideSignUp services={authServices} className="crm-authenticator" components={authComponents}>
          {() => <AppContent onBlocked={setBlocked} />}
        </Authenticator>
      </ThemeProvider>
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
      signOut?.();
    } catch {
      // ignore sign-out failures and continue rendering
    }
  };

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

  return <MainLayout signOut={signOut || (() => {})} />;
}
