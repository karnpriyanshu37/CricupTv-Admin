"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The edit / add form opens right in front of the page (a centred window on PC, full screen on phones),
 * so nobody has to scroll up or down to find it. The page behind stays where it was.
 */
export default function FormModal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind does not scroll
    panelRef.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal-panel" ref={panelRef}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
