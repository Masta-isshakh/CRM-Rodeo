import { useEffect, useState, useRef } from "react";
import { getDataClient } from "../../lib/amplifyClient";
import "./editor-styles.css";
import { useGlobalLoading } from "../../utils/GlobalLoadingContext";

interface FormField {
  id: string;
  label: string;
  type: "text" | "email" | "textarea" | "checkbox" | "radio" | "dropdown";
  required: boolean;
  options?: string[];
}

interface FormsEditorProps {
  fileId?: string;
  fileName?: string;
}

export default function FormsEditor({ fileId, fileName }: FormsEditorProps) {
  const { showLoading, hideLoading } = useGlobalLoading();
  const [fields, setFields] = useState<FormField[]>([]);
  const [title, setTitle] = useState(fileName || "Untitled Form");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(!!fileId);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const client = getDataClient();

  // Load existing form if fileId is provided
  useEffect(() => {
    if (!fileId) {
      setIsLoading(false);
      return;
    }

    const loadForm = async () => {
      showLoading("Loading form...");
      try {
        const response = await (client.models as any).FileShareItem.get({ id: fileId });
        if (response?.data) {
          const item = response.data as any;
          setTitle(item.displayName || "Untitled Form");
          if (item.description) {
            try {
              const parsed = JSON.parse(item.description);
              setFields(parsed.fields || []);
              setDescription(parsed.description || "");
            } catch {
              setFields([]);
            }
          }
          setLastSaved(item.updatedAt ? new Date(item.updatedAt) : null);
        }
      } catch (error) {
        console.error("Failed to load form:", error);
      } finally {
        setIsLoading(false);
        hideLoading();
      }
    };

    loadForm();
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
        const formContent = JSON.stringify({ fields, description });

        await (client.models as any).FileShareItem.update({
          id: fileId,
          displayName: title || "Untitled Form",
          description: formContent,
          updatedAt: now.toISOString(),
        });

        setLastSaved(new Date());
      } catch (error) {
        console.error("Failed to auto-save form:", error);
      } finally {
        setIsSaving(false);
      }
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [fields, title, description, fileId, client]);

  const handleAddField = (type: FormField["type"]) => {
    const newField: FormField = {
      id: String(Date.now()),
      label: `Field ${fields.length + 1}`,
      type,
      required: false,
      options: type === "dropdown" || type === "radio" ? ["Option 1", "Option 2"] : undefined,
    };
    setFields([...fields, newField]);
  };

  const handleDeleteField = (id: string) => {
    setFields(fields.filter((f) => f.id !== id));
  };

  const handleFieldChange = (id: string, key: keyof FormField, value: any) => {
    setFields(
      fields.map((f) =>
        f.id === id ? { ...f, [key]: value } : f
      )
    );
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
  };

  const handleGoBack = () => {
    window.close();
  };

  if (isLoading) {
    return (
      <div className="editor-container">
        <div className="editor-loading">Loading form...</div>
      </div>
    );
  }

  return (
    <div className="editor-container forms-editor">
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
            placeholder="Untitled Form"
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

      <div className="forms-container">
        <div className="form-builder">
          <div className="form-header-section">
            <textarea
              className="form-description"
              value={description}
              onChange={handleDescriptionChange}
              placeholder="Form description (optional)"
              rows={2}
            />
          </div>

          <div className="form-fields">
            {fields.length === 0 ? (
              <div className="empty-state">
                <i className="fa fa-plus-circle"></i>
                <p>Add questions to your form</p>
              </div>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="form-field-editor">
                  <div className="field-header">
                    <input
                      type="text"
                      className="field-label-input"
                      value={field.label}
                      onChange={(e) => handleFieldChange(field.id, "label", e.target.value)}
                      placeholder="Question"
                    />
                    <div className="field-actions">
                      <select
                        value={field.type}
                        onChange={(e) =>
                          handleFieldChange(field.id, "type", e.target.value as FormField["type"])
                        }
                        className="field-type-select"
                      >
                        <option value="text">Short text</option>
                        <option value="email">Email</option>
                        <option value="textarea">Long text</option>
                        <option value="checkbox">Checkboxes</option>
                        <option value="radio">Multiple choice</option>
                        <option value="dropdown">Dropdown</option>
                      </select>
                      <label className="field-required-checkbox">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => handleFieldChange(field.id, "required", e.target.checked)}
                        />
                        Required
                      </label>
                      <button
                        className="field-delete-btn"
                        onClick={() => handleDeleteField(field.id)}
                        title="Delete field"
                      >
                        <i className="fa fa-trash"></i>
                      </button>
                    </div>
                  </div>

                  {(field.type === "dropdown" || field.type === "radio" || field.type === "checkbox") &&
                    field.options && (
                      <div className="field-options">
                        {field.options.map((option, index) => (
                          <div key={index} className="option-row">
                            <input
                              type="text"
                              value={option}
                              onChange={(e) => {
                                const newOptions = [...field.options!];
                                newOptions[index] = e.target.value;
                                handleFieldChange(field.id, "options", newOptions);
                              }}
                              placeholder={`Option ${index + 1}`}
                            />
                            <button
                              onClick={() => {
                                const newOptions = field.options!.filter((_, i) => i !== index);
                                handleFieldChange(field.id, "options", newOptions);
                              }}
                              className="option-delete-btn"
                            >
                              <i className="fa fa-times"></i>
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            handleFieldChange(field.id, "options", [
                              ...field.options!,
                              `Option ${field.options!.length + 1}`,
                            ]);
                          }}
                          className="option-add-btn"
                        >
                          <i className="fa fa-plus"></i> Add option
                        </button>
                      </div>
                    )}
                </div>
              ))
            )}
          </div>

          <div className="form-add-field-section">
            <div className="field-type-buttons">
              <button onClick={() => handleAddField("text")} className="add-field-btn" title="Add text field">
                <i className="fa fa-font"></i> Text
              </button>
              <button onClick={() => handleAddField("email")} className="add-field-btn" title="Add email field">
                <i className="fa fa-envelope"></i> Email
              </button>
              <button onClick={() => handleAddField("textarea")} className="add-field-btn" title="Add textarea">
                <i className="fa fa-align-left"></i> Long text
              </button>
              <button onClick={() => handleAddField("checkbox")} className="add-field-btn" title="Add checkboxes">
                <i className="fa fa-check-square"></i> Checkboxes
              </button>
              <button onClick={() => handleAddField("radio")} className="add-field-btn" title="Add multiple choice">
                <i className="fa fa-dot-circle"></i> Multiple choice
              </button>
              <button onClick={() => handleAddField("dropdown")} className="add-field-btn" title="Add dropdown">
                <i className="fa fa-list"></i> Dropdown
              </button>
            </div>
          </div>
        </div>

        <div className="form-preview">
          <div className="preview-title">{title}</div>
          {description && <div className="preview-description">{description}</div>}
          {fields.map((field) => (
            <div key={field.id} className="preview-field">
              <label className="preview-label">
                {field.label}
                {field.required && <span className="required-mark">*</span>}
              </label>
              {field.type === "text" && (
                <input type="text" className="preview-input" placeholder="Answer" disabled />
              )}
              {field.type === "email" && (
                <input type="email" className="preview-input" placeholder="your@email.com" disabled />
              )}
              {field.type === "textarea" && (
                <textarea className="preview-textarea" placeholder="Answer" disabled></textarea>
              )}
              {(field.type === "checkbox" || field.type === "radio") && (
                <div className="preview-options">
                  {field.options?.map((option) => (
                    <label key={option} className="preview-option">
                      <input type={field.type === "checkbox" ? "checkbox" : "radio"} disabled />
                      {option}
                    </label>
                  ))}
                </div>
              )}
              {field.type === "dropdown" && (
                <select className="preview-select" disabled>
                  <option>Choose from list</option>
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <button className="preview-submit-btn" disabled>
            Submit
          </button>
        </div>
      </div>

      <div className="editor-footer">
        <span className="editor-file-type">Form</span>
        <span className="editor-field-count">{fields.length} questions</span>
      </div>
    </div>
  );
}
