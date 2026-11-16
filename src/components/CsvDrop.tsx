"use client";

import { useState } from "react";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";

/** File picker styled as a drop zone. Click or drag a .csv onto it; shows the chosen file. */
export function CsvDrop({ name = "file" }: { name?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);

  return (
    <label
      className={`csv-drop ${over ? "over" : ""} ${file ? "has-file" : ""}`}
      onDragOver={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
    >
      {/* The real input covers the box, so a dropped file lands in it natively. */}
      <input type="file" name={name} accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <>
          <span className="csv-drop-icon done">
            <FileSpreadsheet size={22} aria-hidden="true" />
          </span>
          <span className="csv-drop-text">
            <b>{file.name}</b>
            <small>{(file.size / 1024).toFixed(1)} KB · click to choose a different file</small>
          </span>
          <X size={16} aria-hidden="true" className="csv-drop-x" />
        </>
      ) : (
        <>
          <span className="csv-drop-icon">
            <UploadCloud size={22} aria-hidden="true" />
          </span>
          <span className="csv-drop-text">
            <b>Drop your CSV here, or click to browse</b>
            <small>In Excel: File → Save As → CSV</small>
          </span>
        </>
      )}
    </label>
  );
}
