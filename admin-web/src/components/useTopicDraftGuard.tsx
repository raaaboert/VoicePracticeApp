"use client";

import { useEffect, useRef, useState } from "react";

export type RequestWorkspaceLeave = (leave: () => void) => void;

export function useTopicDraftGuard(dirty: boolean, save: () => Promise<boolean>, discard: () => void, blocked = false) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const latest = useRef({ dirty, save, discard, blocked });
  latest.current = { dirty, save, discard, blocked };
  const requestLeave: RequestWorkspaceLeave = (leave) => {
    if (latest.current.blocked) return;
    if (latest.current.dirty) { setSaveError(false); setPending(() => leave); }
    else leave();
  };
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [pending]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!latest.current.dirty) return;
      event.preventDefault(); event.returnValue = "";
    };
    const link = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.download
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0
        || !latest.current.dirty || anchor.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (latest.current.blocked) return;
      setPending(() => () => window.location.assign(anchor.href));
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); };
  }, []);
  return { requestLeave, confirmation: <dialog ref={dialog} className="topic-draft-dialog"
    aria-labelledby="topic-draft-title" aria-describedby="topic-draft-description"
    onCancel={(event) => { event.preventDefault(); if (!saving && !blocked) setPending(null); }}>
    <h3 id="topic-draft-title">Unsaved Focus Topic changes</h3>
    <p id="topic-draft-description">Save your metadata changes before leaving, or discard them.</p>
    {saveError ? <p className="error" role="alert">Could not save the Focus Topic. Cancel to review the editor error, or retry Save. Your changes are retained.</p> : null}
    <div className="card-actions">
      <button type="button" autoFocus disabled={saving || blocked} onClick={() => setPending(null)}>Cancel</button>
      <button type="button" disabled={saving || blocked} onClick={() => {
        latest.current.discard(); latest.current.dirty = false;
        const leave = pending; setPending(null); leave?.();
      }}>Discard</button>
      <button type="button" className="primary" disabled={saving || blocked} onClick={async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try { if (await latest.current.save()) {
          latest.current.dirty = false;
          const leave = pending; setPending(null); leave?.();
        } else setSaveError(true); }
        finally { savingRef.current = false; setSaving(false); }
      }}>{saving ? "Saving…" : "Save"}</button>
    </div>
  </dialog> };
}
