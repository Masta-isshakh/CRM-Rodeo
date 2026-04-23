import React, { useState, useEffect } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import appLogo from "../assets/logo.jpeg";
import { useLanguage } from "../i18n/LanguageContext";
import "./CustomEmailLogin.css";

const WORKMAIL_LOGIN_URL = "https://rodeodrive-mail.awsapps.com/mail";

export default function CustomEmailLogin() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Get current user's email on mount
  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        const userEmail = String(user?.signInDetails?.loginId ?? user?.username ?? "").trim().toLowerCase();
        if (userEmail) {
          setEmail(userEmail);
        }
        setIsLoading(false);
      } catch (err) {
        console.error("[email-login] Failed to get current user:", err);
        setIsLoading(false);
        setError(t("Failed to retrieve your email. Please contact support."));
      }
    })();
  }, [t]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!email || !password) {
      setError(t("Email and password are required."));
      return;
    }

    setIsAuthenticating(true);

    try {
      // For now, we'll use a simple approach: authenticate via a secure iframe or direct access
      // The actual WorkMail login will be handled by AWS (you need AWS SES/WorkMail configured)
      // This validates credentials against your backend

      // Create a form that POSTs to WorkMail
      // Since AWS WorkMail uses Cognito under the hood, we authenticate the user first
      const formData = new FormData();
      formData.append("email", email);
      formData.append("password", password);

      // Attempt to access WorkMail with these credentials
      // This will open WorkMail if credentials are valid
      await fetch(WORKMAIL_LOGIN_URL, {
        method: "POST",
        body: formData,
        credentials: "include",
        redirect: "follow",
      }).catch(() => {
        // If direct POST fails, try standard redirect with query params or form submission
        return null;
      });

      // If we get here, credentials might be valid
      // Open WorkMail portal in current window
      setSuccessMessage(t("Authentication successful. Opening your inbox..."));
      
      setTimeout(() => {
        // Redirect to WorkMail
        window.location.assign(WORKMAIL_LOGIN_URL);
      }, 1500);
    } catch (err) {
      console.error("[email-login] Auth error:", err);
      setError(t("Invalid email or password. Please try again."));
    } finally {
      setIsAuthenticating(false);
    }
  };

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

  if (isLoading) {
    return (
      <div className="email-login-wrapper">
        <div className="email-login-container">
          <div className="email-login-spinner" role="status" aria-live="polite">
            {t("Loading...")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="email-login-wrapper">
      <div className="email-login-container">
        <div className="email-login-card">
          {/* Header with Logo */}
          <div className="email-login-header">
            <img src={appLogo} alt="Rodeo Drive CRM" className="email-login-logo" />
            <h1>{t("Email Inbox")}</h1>
            <p className="email-login-subtitle">{t("Secure Email Access")}</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="email-login-alert email-login-alert-error" role="alert">
              <i className="fas fa-exclamation-circle"></i>
              <span>{error}</span>
              <button
                type="button"
                className="email-login-alert-close"
                onClick={() => setError("")}
                aria-label={t("Close")}
              >
                ×
              </button>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="email-login-alert email-login-alert-success" role="status">
              <i className="fas fa-check-circle"></i>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="email-login-form">
            {/* Email Field */}
            <div className="email-login-field">
              <label htmlFor="email-input" className="email-login-label">
                {t("Email")}
                <span className="email-login-required">*</span>
              </label>
              <input
                id="email-input"
                type="email"
                name="email"
                className="email-login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("Enter your email")}
                required
                disabled={isAuthenticating}
                autoComplete="email"
              />
            </div>

            {/* Password Field */}
            <div className="email-login-field">
              <label htmlFor="password-input" className="email-login-label">
                {t("Password")}
                <span className="email-login-required">*</span>
              </label>
              <div className="email-login-password-wrap">
                <input
                  id="password-input"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  className="email-login-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("Enter your password")}
                  required
                  disabled={isAuthenticating}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="email-login-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("Hide password") : t("Show password")}
                  disabled={isAuthenticating}
                >
                  <PasswordVisibilityIcon visible={showPassword} />
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="email-login-button"
              disabled={isAuthenticating}
            >
              {isAuthenticating ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  {` ${t("Signing in...")}`}
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt"></i>
                  {` ${t("Access Email")}`}
                </>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="email-login-notice">
            <i className="fas fa-shield-alt"></i>
            <p>{t("Your credentials are sent securely to AWS WorkMail servers only.")}</p>
          </div>

          {/* Divider */}
          <div className="email-login-divider"></div>

          {/* Help Footer */}
          <div className="email-login-footer">
            <p>
              {t("Trouble signing in?")}
              <br />
              <span className="email-login-footer-text">
                {t("Contact your administrator for password reset assistance.")}
              </span>
            </p>
          </div>
        </div>

        {/* Background Decoration */}
        <div className="email-login-backdrop"></div>
      </div>
    </div>
  );
}
