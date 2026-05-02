import { useEffect, useState, useRef } from "react";
import { getDataClient } from "../../lib/amplifyClient";
import "./editor-styles.css";

interface Slide {
  id: string;
  title: string;
  content: string;
}

interface SlidesEditorProps {
  fileId?: string;
  fileName?: string;
}

export default function SlidesEditor({ fileId, fileName }: SlidesEditorProps) {
  const [presentation, setPresentation] = useState<Slide[]>([
    { id: "1", title: "Slide Title", content: "Click to add subtitle" },
  ]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [title, setTitle] = useState(fileName || "Untitled Presentation");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(!!fileId);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const client = getDataClient();

  // Load existing presentation if fileId is provided
  useEffect(() => {
    if (!fileId) {
      setIsLoading(false);
      return;
    }

    const loadPresentation = async () => {
      try {
        const response = await (client.models as any).FileShareItem.get({ id: fileId });
        if (response?.data) {
          const item = response.data as any;
          setTitle(item.displayName || "Untitled Presentation");
          if (item.description) {
            try {
              setPresentation(JSON.parse(item.description));
            } catch {
              setPresentation([{ id: "1", title: "Slide Title", content: "Click to add subtitle" }]);
            }
          }
          setLastSaved(item.updatedAt ? new Date(item.updatedAt) : null);
        }
      } catch (error) {
        console.error("Failed to load presentation:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPresentation();
  }, [fileId, client]);

  // Auto-save functionality
  useEffect(() => {
    if (!fileId) {
      setIsSaving(false);
      return;
    }

    setIsSaving(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const now = new Date();
        const presentationJson = JSON.stringify(presentation);

        await (client.models as any).FileShareItem.update({
          id: fileId,
          displayName: title || "Untitled Presentation",
          description: presentationJson,
          updatedAt: now.toISOString(),
        });

        setLastSaved(new Date());
      } catch (error) {
        console.error("Failed to auto-save presentation:", error);
      } finally {
        setIsSaving(false);
      }
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [presentation, title, fileId, client]);

  const currentSlide = presentation[currentSlideIndex];

  const handleAddSlide = () => {
    const newSlide: Slide = {
      id: String(Date.now()),
      title: "New Slide",
      content: "Add content here",
    };
    setPresentation([...presentation, newSlide]);
    setCurrentSlideIndex(presentation.length);
  };

  const handleDeleteSlide = (index: number) => {
    if (presentation.length === 1) return;
    const newPresentation = presentation.filter((_, i) => i !== index);
    setPresentation(newPresentation);
    if (currentSlideIndex >= newPresentation.length) {
      setCurrentSlideIndex(newPresentation.length - 1);
    }
  };

  const handleDuplicateSlide = (index: number) => {
    const slide = presentation[index];
    const newSlide: Slide = {
      id: String(Date.now()),
      title: slide.title,
      content: slide.content,
    };
    const newPresentation = [...presentation];
    newPresentation.splice(index + 1, 0, newSlide);
    setPresentation(newPresentation);
  };

  const handleSlideChange = (index: number, field: "title" | "content", value: string) => {
    const newPresentation = [...presentation];
    newPresentation[index] = { ...newPresentation[index], [field]: value };
    setPresentation(newPresentation);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleGoBack = () => {
    window.close();
  };

  if (isLoading) {
    return (
      <div className="editor-container">
        <div className="editor-loading">Loading presentation...</div>
      </div>
    );
  }

  return (
    <div className="editor-container slides-editor">
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
            placeholder="Untitled Presentation"
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

      <div className="slides-container">
        <div className="slides-sidebar">
          <div className="slides-sidebar-header">
            <button className="slides-add-btn" onClick={handleAddSlide} title="Add new slide">
              <i className="fa fa-plus"></i> New Slide
            </button>
          </div>
          <div className="slides-list">
            {presentation.map((slide, index) => (
              <div
                key={slide.id}
                className={`slide-thumbnail ${currentSlideIndex === index ? "active" : ""}`}
                onClick={() => setCurrentSlideIndex(index)}
              >
                <div className="slide-thumbnail-content">
                  <p className="slide-thumbnail-title">{slide.title}</p>
                  <p className="slide-thumbnail-text">{slide.content}</p>
                </div>
                <div className="slide-thumbnail-number">{index + 1}</div>
                <div className="slide-actions">
                  <button
                    className="slide-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateSlide(index);
                    }}
                    title="Duplicate slide"
                  >
                    <i className="fa fa-copy"></i>
                  </button>
                  <button
                    className="slide-action-btn delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSlide(index);
                    }}
                    title="Delete slide"
                  >
                    <i className="fa fa-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="slides-canvas">
          <div className="slide-content">
            <textarea
              className="slide-title-area"
              value={currentSlide.title}
              onChange={(e) => handleSlideChange(currentSlideIndex, "title", e.target.value)}
              placeholder="Slide Title"
            />
            <textarea
              className="slide-text-area"
              value={currentSlide.content}
              onChange={(e) => handleSlideChange(currentSlideIndex, "content", e.target.value)}
              placeholder="Add content here"
            />
          </div>

          <div className="slide-footer">
            <span className="slide-counter">
              Slide {currentSlideIndex + 1} of {presentation.length}
            </span>
            <div className="slide-nav-buttons">
              <button
                className="slide-nav-btn"
                onClick={() => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1))}
                disabled={currentSlideIndex === 0}
              >
                <i className="fa fa-chevron-left"></i>
              </button>
              <button
                className="slide-nav-btn"
                onClick={() => setCurrentSlideIndex(Math.min(presentation.length - 1, currentSlideIndex + 1))}
                disabled={currentSlideIndex === presentation.length - 1}
              >
                <i className="fa fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="editor-footer">
        <span className="editor-file-type">Presentation (Slides)</span>
        <span className="editor-slide-count">{presentation.length} slides</span>
      </div>
    </div>
  );
}
