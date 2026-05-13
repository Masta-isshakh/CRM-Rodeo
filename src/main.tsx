// src/main.tsx
import "./amplifyConfig"; // ✅ must be FIRST

import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { LanguageProvider } from "./i18n/LanguageContext";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
);
