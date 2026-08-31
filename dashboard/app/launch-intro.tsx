"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeploymentView } from "./deployment-data";

const INTRO_EXIT_MS = 2_200;
const INTRO_DONE_MS = 2_850;

export default function LaunchIntro({ deployment }: { deployment: DeploymentView }) {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const manualTimer = useRef<number | null>(null);
  const exitStarted = useRef(false);

  const close = useCallback(() => {
    if (exitStarted.current) return;
    exitStarted.current = true;
    setExiting(true);
    manualTimer.current = window.setTimeout(() => setVisible(false), 620);
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const exitTimer = window.setTimeout(() => {
      exitStarted.current = true;
      setExiting(true);
    }, INTRO_EXIT_MS);
    const doneTimer = window.setTimeout(() => setVisible(false), INTRO_DONE_MS);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
      if (manualTimer.current !== null) window.clearTimeout(manualTimer.current);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close, visible]);

  if (!visible) return null;

  return (
    <div
      aria-describedby="launch-intro-description"
      aria-label="ThetaShield protocol introduction"
      aria-modal="true"
      className={`launch-intro${exiting ? " is-exiting" : ""}`}
      role="dialog"
    >
      <div className="launch-intro-atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <div className="launch-intro-meta" aria-hidden="true">
        <span>THETASHIELD / PROTOCOL 01</span>
        <span>DIRECTIONAL PROTECTION LAYER</span>
      </div>

      <div className="launch-intro-lockup">
        <div className="launch-intro-mark" aria-hidden="true">
          <svg viewBox="0 0 120 132">
            <path className="launch-shield-echo" d="M60 6 108 24v34c0 30-18 54-48 68C30 112 12 88 12 58V24L60 6Z" />
            <path className="launch-shield-outline" d="M60 12 101 28v30c0 26-15 46-41 59C34 104 19 84 19 58V28L60 12Z" />
            <path className="launch-shield-core" d="M60 25 88 36v22c0 18-9 32-28 42-19-10-28-24-28-42V36L60 25Z" />
          </svg>
          <span>θ</span>
          <i className="launch-intro-scan" />
        </div>

        <div className="launch-intro-copy">
          <span className="launch-intro-eyebrow">UNISWAP V4 · DELAYED EVIDENCE</span>
          <div className="launch-intro-wordmark"><b>THETA</b><em>SHIELD</em></div>
          <p id="launch-intro-description">Directional fees that protect liquidity from informed flow—not ordinary market noise.</p>
        </div>

        <div className="launch-intro-sequence" aria-hidden="true">
          <span><i />01 · OBSERVE</span>
          <span><i />02 · VERIFY</span>
          <span><i />03 · PROTECT</span>
        </div>

        <div className="launch-intro-progress" aria-hidden="true">
          <i />
          <span>INITIALIZING CONTROL LOOP</span>
        </div>
      </div>

      <div className="launch-intro-foot" aria-hidden="true">
        <span>{deployment.networks.map((network) => network.name).join(" · ").toUpperCase()}</span>
        <span><i /> {`LIVE TESTNET SYSTEM · CYCLE ${deployment.acceptance.reactiveCycleId} PROVEN`}</span>
      </div>
      <button autoFocus className="launch-intro-skip" onClick={close} type="button">
        Skip intro <span>↗</span>
      </button>
    </div>
  );
}
