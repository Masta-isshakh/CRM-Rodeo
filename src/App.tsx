import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import MainLayout from "./components/MainLayout";

export default function App() {
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
