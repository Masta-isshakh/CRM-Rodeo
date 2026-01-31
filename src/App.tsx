import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import MainLayout from "./components/MainLayout";
import SetPasswordPage from "./pages/SetPassword";

export default function App() {
  const path = window.location.pathname;

  // ✅ allow public set-password route
  if (path.startsWith("/set-password")) {
    return <SetPasswordPage />;
  }

  return (
    <Authenticator hideSignUp>
      {() => <AppContent />}
    </Authenticator>
  );
}

function AppContent() {
  const { signOut } = useAuthenticator((context) => [context.user]);
  return <MainLayout signOut={signOut || (() => {})} />;
}
