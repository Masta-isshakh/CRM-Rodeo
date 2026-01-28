// amplify/auth/custom-message/handler.ts

// Keep this file dependency-free (no aws-amplify imports).
// Cognito CustomMessage trigger: return the same event with emailSubject/emailMessage updated.

type AnyEvent = any;

function getAppUrl(event: AnyEvent) {
  // Best: set APP_URL as an environment variable on the function.
  // Fallbacks: clientMetadata from Cognito calls, or a safe default.
  return (
    process.env.APP_URL ||
    event?.request?.clientMetadata?.appUrl ||
    "https://main.d306x3a8sfnpva.amplifyapp.com" // change to your real domain
  );
}

export const handler = async (event: AnyEvent) => {
  const appUrl = getAppUrl(event);

  const email = (event?.request?.userAttributes?.email || event?.userName || "").toLowerCase();
  const code = event?.request?.codeParameter || "{####}";
  const usernameParam = event?.request?.usernameParameter || "{username}";

  // Your app routes
  const signInUrl = `${appUrl}/`; // login page (Authenticator)
  const setPasswordUrl = email
    ? `${appUrl}/set-password?email=${encodeURIComponent(email)}`
    : `${appUrl}/set-password`;

  // Trigger types: CustomMessage_AdminCreateUser, CustomMessage_ForgotPassword, etc.
  const src: string = event?.triggerSource || "";

  // Default subject/message
  let subject = "Rodeo Drive CRM";
  let message = `Hello,\n\nSign in: ${signInUrl}\n`;

  // Admin user invite (AdminCreateUser)
  if (src.includes("AdminCreateUser")) {
    subject = "You’ve been invited to Rodeo Drive CRM";
    message =
      `Hello,\n\n` +
      `An account has been created for you.\n\n` +
      `Username: ${usernameParam}\n` +
      `Set your password here:\n${setPasswordUrl}\n\n` +
      `After setting your password, sign in here:\n${signInUrl}\n\n` +
      `Thank you.`;
  }

  // Forgot password
  if (src.includes("ForgotPassword")) {
    subject = "Reset your password";
    message =
      `Hello,\n\n` +
      `Your verification code is: ${code}\n\n` +
      `Or reset using the app page:\n${setPasswordUrl}\n\n` +
      `Sign in:\n${signInUrl}\n`;
  }

  // Assign
  event.response = event.response || {};
  event.response.emailSubject = subject;
  event.response.emailMessage = message;

  return event;
};
