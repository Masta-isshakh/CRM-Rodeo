import { useEffect, useMemo, useState } from "react";
import { Authenticator, ThemeProvider, useAuthenticator, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { getCurrentUser, signIn } from "aws-amplify/auth";
import MainLayout from "./components/MainLayout";
import SetPasswordPage from "./pages/SetPassword";
import { getDataClient } from "./lib/amplifyClient";
import appLogo from "./assets/logo.jpeg";
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
          <img src={appLogo} alt="CRM Logo" className="crm-auth-logo" />
          <h1>Login</h1>
        </div>
      );
    },
    FormFields() {
      const [password, setPassword] = useState("");

      const rules = [
        {
          label: "At least 8 characters",
          valid: password.length >= 8,
        },
        {
          label: "At least 1 uppercase letter",
          valid: /[A-Z]/.test(password),
        },
        {
          label: "At least 1 lowercase letter",
          valid: /[a-z]/.test(password),
        },
        {
          label: "At least 1 number",
          valid: /\d/.test(password),
        },
        {
          label: "At least 1 special character",
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
            label="Email"
            placeholder="Enter your email"
            required
          />

          <TextField
            name="password"
            type="password"
            autoComplete="current-password"
            label="Password"
            placeholder="Enter your password"
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            required
          />

          {!allRulesMet && (
            <div className="crm-auth-password-rules" aria-live="polite">
              <div className="crm-auth-password-rules-title">Password requirements</div>
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
              <span>Remember me</span>
            </label>
            <span className="crm-auth-forgot-text">Forgot Password?</span>
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
    return <SetPasswordPage />;
  }

  return (
    <>
      {blockedMessage && (
        <div className="crm-auth-block-banner" role="alert">
          <span>{blockedMessage}</span>
          <button type="button" onClick={() => setBlocked("")}>Dismiss</button>
        </div>
      )}
      <ThemeProvider theme={crmAuthTheme as any}>
        <Authenticator hideSignUp services={authServices} className="crm-authenticator" components={authComponents}>
          {() => <AppContent onBlocked={setBlocked} />}
        </Authenticator>
      </ThemeProvider>
    </>
  );
}

function AppContent({ onBlocked }: { onBlocked: (message: string) => void }) {
  const client = useMemo(() => getDataClient(), []);
  const { signOut } = useAuthenticator((context) => [context.user]);
  const [sessionChecked, setSessionChecked] = useState(false);

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
        onBlocked("We could not verify your session. Please sign in again.");
        safeSignOut();
      } finally {
        debugLog("Session verification completed");
        if (!cancelled) setSessionChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, onBlocked, signOut]);

  if (!sessionChecked) {
    return (
      <div className="crm-auth-loading" role="status" aria-live="polite">
        Checking your session...
      </div>
    );
  }

  return <MainLayout signOut={signOut || (() => {})} />;
}
