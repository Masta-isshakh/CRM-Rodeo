import { useEffect, useMemo, Suspense } from "react";
import DocsEditor from "./DocsEditor";
import SheetsEditor from "./SheetsEditor";
import SlidesEditor from "./SlidesEditor";
import FormsEditor from "./FormsEditor";
import "./editor-styles.css";

const DRIVE_EDITOR_CLOSED_EVENT_KEY = "crm.drive.editor.closed";

type EditorType = "docs" | "sheets" | "slides" | "forms";

interface EditorPageProps {
  editorType: EditorType;
  fileId?: string;
  fileName?: string;
}

export default function EditorPage({ editorType, fileId, fileName }: EditorPageProps) {
  useEffect(() => {
    if (!fileId) return;

    const signalEditorClosed = () => {
      try {
        localStorage.setItem(
          DRIVE_EDITOR_CLOSED_EVENT_KEY,
          JSON.stringify({ fileId, editorType, closedAt: new Date().toISOString() })
        );
      } catch {
        // best effort
      }
    };

    window.addEventListener("pagehide", signalEditorClosed);
    return () => window.removeEventListener("pagehide", signalEditorClosed);
  }, [fileId, editorType]);

  const editor = useMemo(() => {
    switch (editorType) {
      case "docs":
        return <DocsEditor fileId={fileId} fileName={fileName} />;
      case "sheets":
        return <SheetsEditor fileId={fileId} fileName={fileName} />;
      case "slides":
        return <SlidesEditor fileId={fileId} fileName={fileName} />;
      case "forms":
        return <FormsEditor fileId={fileId} fileName={fileName} />;
      default:
        return <div>Unknown editor type</div>;
    }
  }, [editorType, fileId, fileName]);

  return <Suspense fallback={<div className="editor-container editor-loading">Loading editor...</div>}>{editor}</Suspense>;
}
