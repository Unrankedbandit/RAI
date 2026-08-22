"use client";

import { useProject } from "./ProjectContext";

/**
 * Documents tab — faithful port of the reference `#page-documents`: a single
 * card listing every uploaded document with its file-size label. One `.doc-row`
 * per project document, hairline-separated (first row has no top border).
 */
export function DocumentsTab() {
  const { documents } = useProject();

  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-7 shadow-card">
      <div className="mb-2 text-[15px] font-semibold text-ink">Documents</div>
      {documents.map((doc, i) => (
        <div
          key={doc.id}
          className={`flex items-center justify-between py-3 text-[13px] ${
            i === 0 ? "" : "border-t border-hairline"
          }`}
        >
          <span className="font-medium text-ink">{doc.title}</span>
          <span className="text-[11.5px] text-faint">{doc.size}</span>
        </div>
      ))}
    </div>
  );
}
