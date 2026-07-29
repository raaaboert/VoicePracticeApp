"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      stayButtonRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirmation-backdrop" role="presentation" onMouseDown={onStay}>
      <div
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirmation-dialog-header">
          <span className="confirmation-dialog-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <div>
            <h2 id="unsaved-changes-title">Discard unsaved changes?</h2>
            <p>Your edits have not been saved.</p>
          </div>
          <button className="icon-button" type="button" onClick={onStay} title="Close">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="confirmation-dialog-actions">
          <button ref={stayButtonRef} className="ghost-button" type="button" onClick={onStay}>
            Keep editing
          </button>
          <button className="primary-button" type="button" onClick={onLeave}>
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}
