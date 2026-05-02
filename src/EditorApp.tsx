import { useEffect, useState } from "react";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import EditorPage from "./pages/editors/EditorPage";

type EditorType = "docs" | "sheets" | "slides" | "forms";

function EditorApp() {
  const { user } = useAuthenticator((context) => [context.user]);
  const [editorType, setEditorType] = useState<EditorType | null>(null);
  const [fileId, setFileId] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | undefined>();

  useEffect(() => {
    // Parse URL query parameters
    const params = new URLSearchParams(window.location.search);
    const type = params.get("editor") as EditorType | null;
    const id = params.get("fileId") || undefined;
    const name = params.get("fileName") || undefined;

    if (type && ["docs", "sheets", "slides", "forms"].includes(type)) {
      setEditorType(type);
      setFileId(id);
      setFileName(name);
    }
  }, []);

  if (!user) {
    return <Authenticator.Provider><Authenticator /></Authenticator.Provider>;
  }

  if (!editorType) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "#5f7187" }}>
        <p>Invalid editor type. Please open an editor from the File Sharing page.</p>
        <p style={{ fontSize: "12px" }}>Valid types: docs, sheets, slides, forms</p>
      </div>
    );
  }

  return <EditorPage editorType={editorType} fileId={fileId} fileName={fileName} />;
}

export default EditorApp;
