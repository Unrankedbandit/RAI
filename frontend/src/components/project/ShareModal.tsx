"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import type { TeamMember } from "@/lib/types";

// Documents checked by default — mirrors the reference share modal.
const DEFAULT_CHECKED = new Set([
  "feasibility_study.pdf",
  "vendor_proposal.pdf",
  "geotech_report.pdf",
]);

/**
 * Share modal — faithful port of the reference `.modal-*` share dialog.
 * Add team members with an access level, and toggle which documents are
 * visible to shared members. No real send.
 */
export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, teamMembers, documents } = useProject();
  const [members, setMembers] = useState<TeamMember[]>(teamMembers);
  const [draft, setDraft] = useState("");
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(documents.filter((d) => DEFAULT_CHECKED.has(d.title)).map((d) => d.id)),
  );

  const addMember = () => {
    const val = draft.trim();
    if (!val) return;
    setMembers((prev) => [...prev, { name: val, email: "Pending invite", access: "limited" }]);
    setDraft("");
  };

  const toggleDoc = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(11,8,41,.35)]"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="max-h-[86vh] w-[460px] max-w-[92vw] overflow-y-auto rounded-[11px] bg-canvas shadow-pop"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-hairline p-[18px_20px]">
              <div className="text-[15px] font-semibold text-ink">Share {project.name}</div>
              <button
                type="button"
                onClick={onClose}
                className="h-[28px] w-[28px] cursor-pointer rounded-full bg-surface-2 text-[15px] leading-none text-muted"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              <div className="mb-[9px] text-[12.5px] font-semibold text-faint">
                Add team members
              </div>
              <div className="mb-1 flex gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addMember();
                  }}
                  placeholder="Name or email"
                  className="flex-1 rounded-[1px] border border-hairline px-3 py-[9px] text-sm text-ink outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={addMember}
                  className="cursor-pointer rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted"
                >
                  Add
                </button>
              </div>

              {/* Member list */}
              <div>
                {members.map((m, i) => (
                  <div
                    key={`${m.email}-${i}`}
                    className="flex items-center justify-between gap-[10px] border-t border-hairline py-[10px] first:border-t-0"
                  >
                    <div>
                      <div className="text-sm font-medium text-ink">{m.name}</div>
                      <div className="text-[12.5px] text-faint">{m.email}</div>
                    </div>
                    <select
                      defaultValue={m.access === "full" ? "full" : "limited"}
                      className="flex-none rounded-full border border-hairline bg-canvas px-[10px] py-[5px] text-[12.5px] text-muted"
                    >
                      <option value="full">Full access</option>
                      <option value="limited">Limited documents</option>
                    </select>
                  </div>
                ))}
              </div>

              {/* Document permissions */}
              <div className="mb-[9px] mt-[18px] text-[12.5px] font-semibold text-faint">
                Documents visible to shared members
              </div>
              <div className="rounded-[1px] border border-hairline px-3">
                {documents.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex cursor-pointer items-center gap-[9px] border-t border-hairline py-[9px] text-sm text-muted first:border-t-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                    />
                    {doc.title}
                  </label>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-hairline p-[16px_20px]">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-full bg-oxford px-4 py-2 text-sm font-medium text-white"
              >
                Send invites
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
