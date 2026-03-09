// amplify/auth/custom-message/handler.ts
import type { CustomMessageTriggerHandler, CustomMessageTriggerEvent } from "aws-lambda";

function normalizeOrigin(origin: string) {
  return (origin || "").trim().replace(/\/+$/, "");
}

function resolveLogoUrl(origin: string) {
  const configured = String(process.env.APP_LOGO_URL || "").trim();
  if (configured) return configured;
  return origin ? `${origin}/logo.jpeg` : "";
}

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInviteEmailHtml(params: {
  employeeName: string;
  loginPageUrl: string;
  username: string;
  temporaryPasswordPlaceholder: string;
  logoUrl?: string;
}) {
  const employeeName = escapeHtml(params.employeeName);
  const loginPageUrl = escapeHtml(params.loginPageUrl);
  const username = escapeHtml(params.username);
  const temporaryPasswordPlaceholder = escapeHtml(params.temporaryPasswordPlaceholder);
  const logoUrl = escapeHtml(params.logoUrl || "");
  const logoBlock = logoUrl
    ? `<div style="margin:0 0 14px;"><img src="${logoUrl}" alt="Rodeo Drive CRM" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);object-fit:cover;" /></div>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to Rodeo Drive CRM</title>
  </head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;">
      <tr>
        <td style="padding:0;">
          <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:18px 18px 0 0;padding:28px 28px 20px;">
            ${logoBlock}
            <div style="display:inline-block;background:rgba(255,255,255,.12);color:#e2e8f0;border:1px solid rgba(255,255,255,.22);padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.3px;">
              Rodeo Drive CRM
            </div>
            <h1 style="margin:14px 0 0;color:#ffffff;font-size:27px;line-height:1.2;font-weight:800;">Welcome to Rodeo Drive CRM</h1>
          </div>
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 18px 18px;padding:28px;box-shadow:0 18px 40px rgba(15,23,42,.08);">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear <strong>${employeeName}</strong>,</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">Your access for Rodeo Drive CRM has been created. We're excited to have you on board!</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1e293b;">Please use the credentials below to log in.</p>

            <div style="background:#f8fafc;border:1px solid #dbeafe;border-radius:14px;padding:16px 18px;margin:0 0 20px;">
              <div style="margin:0 0 12px;padding:0 0 12px;border-bottom:1px dashed #cbd5e1;">
                <div style="font-size:12px;color:#475569;font-weight:700;letter-spacing:.2px;text-transform:uppercase;">Login Page</div>
                <div style="margin-top:4px;font-size:14px;line-height:1.55;word-break:break-word;"><a href="${loginPageUrl}" style="color:#1d4ed8;text-decoration:none;font-weight:700;">${loginPageUrl}</a></div>
              </div>
              <div style="margin:0 0 12px;padding:0 0 12px;border-bottom:1px dashed #cbd5e1;">
                <div style="font-size:12px;color:#475569;font-weight:700;letter-spacing:.2px;text-transform:uppercase;">Username</div>
                <div style="margin-top:4px;font-size:15px;font-weight:700;color:#0f172a;word-break:break-word;">${username}</div>
              </div>
              <div>
                <div style="font-size:12px;color:#475569;font-weight:700;letter-spacing:.2px;text-transform:uppercase;">Temporary Password</div>
                <div style="margin-top:4px;font-size:15px;font-weight:700;color:#0f172a;word-break:break-word;">${temporaryPasswordPlaceholder}</div>
              </div>
            </div>

            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:16px 18px;margin:0 0 20px;">
              <div style="font-size:13px;font-weight:800;color:#9a3412;letter-spacing:.2px;text-transform:uppercase;margin-bottom:10px;">Important Security Instructions</div>
              <ul style="margin:0;padding-left:18px;color:#7c2d12;">
                <li style="margin:0 0 8px;font-size:14px;line-height:1.6;">For security reasons, you will be required to change this password upon your first login.</li>
                <li style="margin:0;font-size:14px;line-height:1.6;">Do not share these credentials with anyone.</li>
              </ul>
            </div>

            <p style="margin:0;font-size:15px;line-height:1.7;color:#1e293b;">Best Regards,</p>
            <p style="margin:4px 0 0;font-size:15px;line-height:1.7;color:#1e293b;font-weight:700;">Rodeo Drive Team</p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildInviteMessageText(params: {
  employeeName: string;
  loginPageUrl: string;
  username: string;
  temporaryPasswordPlaceholder: string;
}) {
  return [
    `Hello ${params.employeeName},`,
    "",
    "Welcome to Rodeo Drive CRM.",
    "",
    `Login page: ${params.loginPageUrl}`,
    `Username: ${params.username}`,
    `Temporary password: ${params.temporaryPasswordPlaceholder}`,
    "",
    "For security, you must change this password at your first login.",
    "Rodeo Drive Team",
  ].join("\n");
}

function buildResetEmailHtml(params: {
  employeeName: string;
  setPasswordUrl: string;
  temporaryPasswordPlaceholder: string;
  logoUrl?: string;
}) {
  const employeeName = escapeHtml(params.employeeName);
  const setPasswordUrl = escapeHtml(params.setPasswordUrl);
  const temporaryPasswordPlaceholder = escapeHtml(params.temporaryPasswordPlaceholder);
  const logoUrl = escapeHtml(params.logoUrl || "");
  const logoBlock = logoUrl
    ? `<div style="margin:0 0 14px;"><img src="${logoUrl}" alt="Rodeo Drive CRM" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);object-fit:cover;" /></div>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;">
      <tr>
        <td style="padding:0;">
          <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:18px 18px 0 0;padding:28px 28px 20px;">
            ${logoBlock}
            <div style="display:inline-block;background:rgba(255,255,255,.12);color:#e2e8f0;border:1px solid rgba(255,255,255,.22);padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.3px;">
              Rodeo Drive CRM
            </div>
            <h1 style="margin:14px 0 0;color:#ffffff;font-size:27px;line-height:1.2;font-weight:800;">Reset your password</h1>
          </div>
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 18px 18px;padding:28px;box-shadow:0 18px 40px rgba(15,23,42,.08);">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear <strong>${employeeName}</strong>,</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;">We received a request to reset the password for your account associated with this email address.</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1e293b;">To reset your password, please click the button below (this link will expire in 2 hours):</p>

            <div style="margin:0 0 18px;">
              <a href="${setPasswordUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1d4ed8;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Reset Password</a>
            </div>

            <div style="background:#f8fafc;border:1px solid #dbeafe;border-radius:14px;padding:16px 18px;margin:0 0 20px;">
              <div style="margin:0 0 12px;padding:0 0 12px;border-bottom:1px dashed #cbd5e1;">
                <div style="font-size:12px;color:#475569;font-weight:700;letter-spacing:.2px;text-transform:uppercase;">Reset Link</div>
                <div style="margin-top:4px;font-size:14px;line-height:1.55;word-break:break-word;"><a href="${setPasswordUrl}" style="color:#1d4ed8;text-decoration:none;font-weight:700;">${setPasswordUrl}</a></div>
              </div>
              <div>
                <div style="font-size:12px;color:#475569;font-weight:700;letter-spacing:.2px;text-transform:uppercase;">Temporary Password</div>
                <div style="margin-top:4px;font-size:15px;font-weight:700;color:#0f172a;word-break:break-word;">${temporaryPasswordPlaceholder}</div>
              </div>
            </div>

            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:16px 18px;margin:0 0 20px;">
              <div style="font-size:13px;font-weight:800;color:#9a3412;letter-spacing:.2px;text-transform:uppercase;margin-bottom:10px;">Security Notice</div>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#7c2d12;">If you did not request a password reset, please ignore this email. Your password will remain unchanged, and your account is secure.</p>
            </div>

            <p style="margin:0;font-size:15px;line-height:1.7;color:#1e293b;">Best Regards,</p>
            <p style="margin:4px 0 0;font-size:15px;line-height:1.7;color:#1e293b;font-weight:700;">Rodeo Drive Team</p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildResetMessageText(params: {
  employeeName: string;
  setPasswordUrl: string;
  temporaryPasswordPlaceholder: string;
}) {
  return [
    `Hello ${params.employeeName},`,
    "",
    "A password reset was requested for your Rodeo Drive CRM account.",
    `Reset link: ${params.setPasswordUrl}`,
    `Temporary password: ${params.temporaryPasswordPlaceholder}`,
    "",
    "If you did not request this, you can ignore this message.",
    "Rodeo Drive Team",
  ].join("\n");
}

function buildUrls(username: string, email: string, mode?: "first" | "reset") {
  const origin = normalizeOrigin(process.env.APP_ORIGIN || "");
  const base = origin || "";

  const safeUsername = encodeURIComponent((username || "").trim());
  const safeEmail = encodeURIComponent((email || "").trim().toLowerCase());

  const signInUrl = `${base}/`;
  const setPasswordUrl =
    mode === "reset"
      ? `${base}/set-password?mode=reset&username=${safeUsername}&email=${safeEmail}`
      : `${base}/set-password?mode=first&username=${safeUsername}&email=${safeEmail}`;

  return { signInUrl, setPasswordUrl, base };
}

function shouldOverrideEmailTemplate() {
  const explicit = String(process.env.CUSTOM_EMAIL_OVERRIDE ?? "").trim().toLowerCase();
  if (explicit === "true" || explicit === "1" || explicit === "yes") return true;
  if (explicit === "false" || explicit === "0" || explicit === "no") return false;

  const mode = String(process.env.COGNITO_EMAIL_SENDING_ACCOUNT ?? "").trim().toUpperCase();
  return mode === "DEVELOPER";
}

export const handler: CustomMessageTriggerHandler = async (event: CustomMessageTriggerEvent & { triggerSource: string }) => {
  const email = String(event.request.userAttributes?.email ?? "").trim();
  const name =
    event.request.userAttributes?.name ||
    event.request.userAttributes?.given_name ||
    event.request.userAttributes?.["custom:fullName"] ||
    "";

  // ✅ IMPORTANT:
  // usernameParameter / codeParameter are placeholders like {username} / {####}.
  // DO NOT use usernameParameter to build your link.
  // Use event.userName (real username) instead.
  const realUsername = String((event as any).userName ?? email ?? "").trim();

  const codePlaceholder = event.request.codeParameter; // {####} (temp password or reset code)
  const { signInUrl, setPasswordUrl } = buildUrls(
    realUsername,
    email,
    event.triggerSource === "CustomMessage_AdminCreateUser" ? "first" : "reset"
  );
  const logoUrl = resolveLogoUrl(normalizeOrigin(process.env.APP_ORIGIN || ""));
  const allowEmailOverride = shouldOverrideEmailTemplate();

  const employeeName = String(name || realUsername || email || "Employee").trim();

  // AdminCreateUser => temp password flow
  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    if (allowEmailOverride) {
      event.response.emailSubject = "Welcome to Rodeo Drive CRM";
      event.response.emailMessage = buildInviteEmailHtml({
        employeeName,
        loginPageUrl: signInUrl,
        username: email || realUsername,
        temporaryPasswordPlaceholder: codePlaceholder,
        logoUrl,
      });
    }

    event.response.smsMessage = buildInviteMessageText({
      employeeName,
      loginPageUrl: signInUrl,
      username: email || realUsername,
      temporaryPasswordPlaceholder: codePlaceholder,
    });

    return event;
  }

  // ForgotPassword => reset code flow
  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    if (allowEmailOverride) {
      event.response.emailSubject = "Reset your password";
      event.response.emailMessage = buildResetEmailHtml({
        employeeName,
        setPasswordUrl,
        temporaryPasswordPlaceholder: codePlaceholder,
        logoUrl,
      });
    }

    event.response.smsMessage = buildResetMessageText({
      employeeName,
      setPasswordUrl,
      temporaryPasswordPlaceholder: codePlaceholder,
    });

    return event;
  }

  // AdminResetUserPassword => reset code flow (admin-triggered)
  if ((event.triggerSource as string) === "CustomMessage_AdminResetUserPassword") {
    if (allowEmailOverride) {
      event.response.emailSubject = "Reset your password";
      event.response.emailMessage = buildResetEmailHtml({
        employeeName,
        setPasswordUrl,
        temporaryPasswordPlaceholder: codePlaceholder,
        logoUrl,
      });
    }

    event.response.smsMessage = buildResetMessageText({
      employeeName,
      setPasswordUrl,
      temporaryPasswordPlaceholder: codePlaceholder,
    });

    return event;
  }

  return event;
};
