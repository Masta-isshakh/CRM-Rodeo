import { useEffect, useState, useRef } from "react";
import { uploadData } from "aws-amplify/storage";
import * as XLSX from "xlsx";
import { getDataClient } from "../../lib/amplifyClient";
import "./editor-styles.css";

interface SheetsEditorProps {
  fileId?: string;
  fileName?: string;
}

export default function SheetsEditor({ fileId, fileName }: SheetsEditorProps) {
  const [data, setData] = useState<Record<string, string>>({}); // Format: "row,col" => "value"
  const [title, setTitle] = useState(fileName || "Untitled Spreadsheet");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(!!fileId);
  const [storagePath, setStoragePath] = useState("");
  const [selectedCell, setSelectedCell] = useState({ row: 0, col: 0 });
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const client = getDataClient();

  const ROWS = 20;
  const COLS = 10;
  const COL_HEADERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  const toXlsxBlob = (sheetData: Record<string, string>) => {
    const grid: string[][] = [];
    for (let row = 0; row < ROWS; row += 1) {
      const cols: string[] = [];
      for (let col = 0; col < COLS; col += 1) {
        cols.push(String(sheetData[`${row},${col}`] ?? ""));
      }
      grid.push(cols);
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(grid);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  // Load existing spreadsheet if fileId is provided
  useEffect(() => {
    if (!fileId) {
      setIsLoading(false);
      return;
    }

    const loadSpreadsheet = async () => {
      try {
        const response = await (client.models as any).FileShareItem.get({ id: fileId });
        if (response?.data) {
          const item = response.data as any;
          setTitle(item.displayName || "Untitled Spreadsheet");
          setStoragePath(String(item.storagePath ?? ""));
          if (item.description) {
            try {
              setData(JSON.parse(item.description));
            } catch {
              setData({});
            }
          }
          setLastSaved(item.updatedAt ? new Date(item.updatedAt) : null);
        }
      } catch (error) {
        console.error("Failed to load spreadsheet:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSpreadsheet();
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
        const dataJson = JSON.stringify(data);
        const xlsxBlob = toXlsxBlob(data);

        if (fileId) {
          if (storagePath) {
            await uploadData({
              path: storagePath,
              data: xlsxBlob,
              options: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            }).result;
          }

          // Update existing spreadsheet
          await (client.models as any).FileShareItem.update({
            id: fileId,
            displayName: title || "Untitled Spreadsheet",
            description: dataJson,
            sizeBytes: xlsxBlob.size,
            updatedAt: now.toISOString(),
          });
        }

        setLastSaved(now);
      } catch (error) {
        console.error("Failed to auto-save spreadsheet:", error);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, title, fileId, client, storagePath]);

  const getCellKey = (row: number, col: number) => `${row},${col}`;
  const getCellValue = (row: number, col: number) => data[getCellKey(row, col)] || "";

  const handleCellChange = (row: number, col: number, value: string) => {
    const key = getCellKey(row, col);
    const newData = { ...data };
    if (value === "") {
      delete newData[key];
    } else {
      newData[key] = value;
    }
    setData(newData);
    setEditingCell(null);
  };

  const handleCellClick = (row: number, col: number) => {
    setSelectedCell({ row, col });
    setEditingCell(getCellKey(row, col));
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
        <div className="editor-loading">Loading spreadsheet...</div>
      </div>
    );
  }

  return (
    <div className="editor-container sheets-editor">
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
            placeholder="Untitled Spreadsheet"
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
          <button className="toolbar-btn" title="Sum">
            Σ
          </button>
        </div>
        <div className="toolbar-divider"></div>
        <div className="toolbar-group">
          <button className="toolbar-btn" title="Increase decimal">
            .0
          </button>
          <button className="toolbar-btn" title="Decrease decimal">
            0.
          </button>
        </div>
      </div>

      <div className="sheets-container">
        <div className="sheets-grid">
          {/* Column headers */}
          <div className="sheet-row sheet-header-row">
            <div className="sheet-cell sheet-corner-cell"></div>
            {Array.from({ length: COLS }).map((_, col) => (
              <div key={`header-${col}`} className="sheet-cell sheet-header-cell">
                {COL_HEADERS[col]}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {Array.from({ length: ROWS }).map((_, row) => (
            <div key={`row-${row}`} className="sheet-row">
              <div className="sheet-cell sheet-row-header-cell">{row + 1}</div>
              {Array.from({ length: COLS }).map((_, col) => {
                const cellKey = getCellKey(row, col);
                const isSelected = selectedCell.row === row && selectedCell.col === col;
                const isEditing = editingCell === cellKey;

                return (
                  <div
                    key={cellKey}
                    className={`sheet-cell ${isSelected ? "selected" : ""} ${isEditing ? "editing" : ""}`}
                    onClick={() => handleCellClick(row, col)}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        defaultValue={getCellValue(row, col)}
                        onBlur={(e) => handleCellChange(row, col, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCellChange(row, col, (e.target as HTMLInputElement).value);
                          } else if (e.key === "Escape") {
                            setEditingCell(null);
                          }
                        }}
                      />
                    ) : (
                      <span>{getCellValue(row, col)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="editor-footer">
        <span className="editor-file-type">Spreadsheet (Sheet)</span>
        <span className="editor-cell-ref">
          {COL_HEADERS[selectedCell.col]}{selectedCell.row + 1}
        </span>
      </div>
    </div>
  );
}
