import React, { useState, useEffect } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import appLogo from "../assets/logo.jpeg";
import { useLanguage } from "../i18n/LanguageContext";
import "./CustomEmailLogin.css";

const WORKMAIL_REGION = String(import.meta.env.VITE_WORKMAIL_REGION ?? "eu-west-1").trim();
const WORKMAIL_ORGANIZATION = String(import.meta.env.VITE_WORKMAIL_ORGANIZATION ?? "rodeodrive-mail").trim();
const WORKMAIL_DEFAULT_ENTRY_URL = `https://webmail.mail.${WORKMAIL_REGION}.awsapps.com/workmail/?organization=${encodeURIComponent(WORKMAIL_ORGANIZATION)}`;
const WORKMAIL_WEBAPP_URL = String(import.meta.env.VITE_WORKMAIL_URL ?? WORKMAIL_DEFAULT_ENTRY_URL).trim();
const WORKMAIL_SSO_START_URL_TEMPLATE = String(
  import.meta.env.VITE_WORKMAIL_IDC_START_URL ?? import.meta.env.VITE_WORKMAIL_SSO_START_URL ?? WORKMAIL_DEFAULT_ENTRY_URL
).trim();
const HAS_EXPLICIT_IDENTITY_CENTER_URL = Boolean(
  String(import.meta.env.VITE_WORKMAIL_IDC_START_URL ?? import.meta.env.VITE_WORKMAIL_SSO_START_URL ?? "").trim()
);

function fillTemplate(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

function buildWorkmailSsoStartUrl(loginValue: string) {
  if (!WORKMAIL_SSO_START_URL_TEMPLATE) return "";
  return fillTemplate(WORKMAIL_SSO_START_URL_TEMPLATE, {
    organization: encodeURIComponent(WORKMAIL_ORGANIZATION),
    returnUrl: encodeURIComponent(WORKMAIL_WEBAPP_URL),
    email: encodeURIComponent(loginValue),
    username: encodeURIComponent(loginValue.includes("@") ? loginValue.split("@")[0] : loginValue),
  });
}

export default function CustomEmailLogin() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
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

    if (!email) {
      setError(t("Email is required."));
      return;
    }

    setIsAuthenticating(true);

    try {
      const loginValue = String(email).trim();
      const ssoStartUrl = buildWorkmailSsoStartUrl(loginValue);

      setSuccessMessage(t("Authentication successful. Opening your inbox..."));

      window.setTimeout(() => {
        if (ssoStartUrl) {
          window.location.assign(ssoStartUrl);
          return;
        }
        // Fallback to AWS WorkMail webapp URL (GET) if SSO start URL template is not configured.
        window.location.assign(WORKMAIL_WEBAPP_URL);
      }, 300);
    } catch (err) {
      console.error("[email-login] Auth error:", err);
      setError(t("Unable to open WorkMail. Please try again."));
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="email-login-wrapper">
        <div className="email-login-container">
          <div className="email-login-spinner" role="status" aria-live="polite">
            <span className="email-login-spinner-circle" aria-hidden="true" />
            <span>{t("Loading...")}</span>
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

            <div className="email-login-notice">
              <i className="fas fa-info-circle"></i>
              <p>{t("Single Sign-On will open your organization identity provider for authentication.")}</p>
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
                  {` ${t("Redirecting...")}`}
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt"></i>
                  {` ${t(HAS_EXPLICIT_IDENTITY_CENTER_URL ? "Continue with SSO" : "Continue to Email")}`}
                </>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="email-login-notice">
            <i className="fas fa-shield-alt"></i>
            <p>
              {t(
                HAS_EXPLICIT_IDENTITY_CENTER_URL
                  ? "Single Sign-On will open your organization identity provider for authentication."
                  : "Your organization currently opens the Amazon WorkMail web application directly."
              )}
            </p>
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
