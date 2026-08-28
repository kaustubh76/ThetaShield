"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INTRO_EXIT_MS = 1_450;
const INTRO_DONE_MS = 2_050;

export default function LaunchIntro() {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const manualTimer = useRef<number | null>(null);

  const close = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    manualTimer.current = window.setTimeout(() => setVisible(false), 420);
  }, [exiting]);

  useEffect(() => {
    if (!visible) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exitTimer = window.setTimeout(() => setExiting(true), INTRO_EXIT_MS);
    const doneTimer = window.setTimeout(() => setVisible(false), INTRO_DONE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
      if (manualTimer.current !== null) window.clearTimeout(manualTimer.current);
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-label="ThetaShield subtle 3D introduction"
      aria-modal="true"
      className={`subtle-intro${exiting ? " is-exiting" : ""}`}
      role="dialog"
    >
      <div className="subtle-intro-lockup">
        <div className="subtle-intro-emblem" aria-hidden="true">
          <div className="subtle-intro-orbit"><i /></div>
          <div className="subtle-shield-stack">
            <span />
            <span />
            <div><b>θ</b></div>
          </div>
        </div>
        <div className="subtle-intro-copy"><b>THETASHIELD</b><span>Directional LP protection</span></div>
        <div className="subtle-intro-line" aria-hidden="true"><i /></div>
      </div>
      <button autoFocus className="subtle-intro-skip" onClick={close} type="button">Skip</button>
    </div>
  );
}
