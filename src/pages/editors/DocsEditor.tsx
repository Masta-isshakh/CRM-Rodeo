import { useEffect, useState, useRef } from "react";
import { uploadData } from "aws-amplify/storage";
import { Document, Packer, Paragraph } from "docx";
import { getDataClient } from "../../lib/amplifyClient";
import "./editor-styles.css";
import { useGlobalLoading } from "../../utils/GlobalLoadingContext";

interface DocsEditorProps {
  fileId?: string;
  fileName?: string;
}

export default function DocsEditor({ fileId, fileName }: DocsEditorProps) {
  const { showLoading, hideLoading } = useGlobalLoading();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState(fileName || "Untitled Document");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(!!fileId);
  const [storagePath, setStoragePath] = useState("");
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const client = getDataClient();

  const toDocxBlob = async (text: string) => {
    const lines = String(text ?? "").split(/\r?\n/);
    const paragraphs = lines.length ? lines.map((line) => new Paragraph(line || " ")) : [new Paragraph("")];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    return Packer.toBlob(doc);
  };

  // Load existing document if fileId is provided
  useEffect(() => {
    if (!fileId) {
      setIsLoading(false);
      return;
    }

    const loadDocument = async () => {
      showLoading("Loading document...");
      try {
        const response = await (client.models as any).FileShareItem.get({ id: fileId });
        if (response?.data) {
          const item = response.data as any;
          setTitle(item.displayName || "Untitled Document");
          setStoragePath(String(item.storagePath ?? ""));
          // Try to load content from description field or storagePath
          setContent(item.description || "");
          setLastSaved(item.updatedAt ? new Date(item.updatedAt) : null);
        }
      } catch (error) {
        console.error("Failed to load document:", error);
      } finally {
        setIsLoading(false);
        hideLoading();
      }
    };

    loadDocument();
  }, [fileId, client]);

  // Auto-save functionality
  useEffect(() => {
    if (!fileId && !title) return;

    setIsSaving(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const now = new Date();

        if (fileId) {
          const blob = await toDocxBlob(content);
          if (storagePath) {
            await uploadData({
              path: storagePath,
              data: blob,
              options: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            }).result;
          }

          // Update existing document
          await (client.models as any).FileShareItem.update({
            id: fileId,
            displayName: title || "Untitled Document",
            description: content,
            sizeBytes: blob.size,
            updatedAt: now.toISOString(),
          });
        }

        setLastSaved(now);
      } catch (error) {
        console.error("Failed to auto-save document:", error);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [content, title, fileId, client, storagePath]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const handleGoBack = () => {
    window.close();
  };

  if (isLoading) {
    return (
      <div className="editor-container">
        <div className="editor-loading">Loading document...</div>
      </div>
    );
  }

  return (
    <div className="editor-container docs-editor">
      <div className="editor-header">
        <div className="editor-header-left">
          <button className="editor-back-btn" onClick={handleGoBack} title="Close editor">
            <i className="fa fa-arrow-left"></i>
          </button>
          <input
            type="text"
            className="editor-title-input"
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled Document"
          />
        </div>
        <div className="editor-header-right">
          {isSaving && <span className="editor-saving-indicator">Saving...</span>}
          {lastSaved && !isSaving && (
            <span className="editor-saved-indicator">
              Saved at {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="toolbar-group">
          <button className="toolbar-btn" title="Bold">
            <strong>B</strong>
          </button>
          <button className="toolbar-btn" title="Italic">
            <i>I</i>
          </button>
          <button className="toolbar-btn" title="Underline">
            <u>U</u>
          </button>
        </div>
        <div className="toolbar-divider"></div>
        <div className="toolbar-group">
          <button className="toolbar-btn" title="Bullet list">
            <i className="fa fa-list-ul"></i>
          </button>
          <button className="toolbar-btn" title="Numbered list">
            <i className="fa fa-list-ol"></i>
          </button>
        </div>
        <div className="toolbar-divider"></div>
        <div className="toolbar-group">
          <button className="toolbar-btn" title="Insert link">
            <i className="fa fa-link"></i>
          </button>
          <button className="toolbar-btn" title="Insert image">
            <i className="fa fa-image"></i>
          </button>
        </div>
      </div>

      <textarea
        className="editor-content"
        value={content}
        onChange={handleContentChange}
        placeholder="Start typing... Your document will auto-save every 2 seconds."
        spellCheck="true"
      />

      <div className="editor-footer">
        <span className="editor-file-type">Document (Doc)</span>
        <span className="editor-word-count">{content.split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}
