"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const INTRO_EXIT_MS = 3_900;
const INTRO_DONE_MS = 4_650;

export default function LaunchIntro() {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const manualTimer = useRef<number | null>(null);

  const close = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    manualTimer.current = window.setTimeout(() => setVisible(false), 720);
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

  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty("--intro-rotate-x", `${-y * 10}deg`);
    event.currentTarget.style.setProperty("--intro-rotate-y", `${x * 14}deg`);
  };

  if (!visible) return null;

  return (
    <div
      aria-label="ThetaShield cinematic protocol boot sequence"
      aria-modal="true"
      className={`launch-intro${exiting ? " is-exiting" : ""}`}
      onPointerMove={trackPointer}
      role="dialog"
    >
      <div className="intro-grid" aria-hidden="true" />
      <div className="intro-glow intro-glow-left" aria-hidden="true" />
      <div className="intro-glow intro-glow-right" aria-hidden="true" />
      <div className="intro-scan" aria-hidden="true" />

      <div className="intro-shell">
        <div className="intro-copy">
          <div className="intro-eyebrow"><span>θ / 01</span><b>OUTCOME-AWARE LIQUIDITY DEFENSE</b></div>
          <h2><span>THETA</span><strong>SHIELD</strong></h2>
          <p>Delayed evidence becomes directional protection.</p>
          <div className="intro-rails" aria-label="ThetaShield protocol layers">
            <span><i />UNISWAP V4</span>
            <span><i />CIRCLE CCTP</span>
            <span><i />REACTIVE NETWORK</span>
          </div>
          <div className="intro-progress" aria-hidden="true"><i /></div>
          <div className="intro-status"><span>CONTROL PLANE ONLINE</span><b>ENTERING LIVE RESEARCH SYSTEM</b></div>
        </div>

        <div className="intro-visual" aria-hidden="true">
          <div className="intro-tilt">
            <div className="intro-shield-scene">
              <div className="intro-orbit intro-orbit-one"><i /><i /><i /></div>
              <div className="intro-orbit intro-orbit-two"><i /><i /></div>
              <div className="intro-orbit intro-orbit-three"><i /></div>
              <div className="intro-axis intro-axis-horizontal" />
              <div className="intro-axis intro-axis-vertical" />
              <div className="intro-shield-stack">
                <span className="intro-shield-layer intro-layer-four" />
                <span className="intro-shield-layer intro-layer-three" />
                <span className="intro-shield-layer intro-layer-two" />
                <span className="intro-shield-layer intro-layer-one" />
                <div className="intro-shield-face">
                  <span className="intro-shield-glyph">θ</span>
                  <small>ADAPTIVE FEE<br />CONTROL</small>
                </div>
              </div>
              <div className="intro-energy-core" />
              <div className="intro-coordinate intro-coordinate-a">Δt · 60s</div>
              <div className="intro-coordinate intro-coordinate-b">3 / 5 PERSISTENCE</div>
              <div className="intro-coordinate intro-coordinate-c">500 PIPS · SAFE</div>
            </div>
          </div>
        </div>
      </div>

      <button autoFocus className="intro-skip" onClick={close} type="button">Skip intro <span>↗</span></button>
      <div className="intro-corner intro-corner-top" aria-hidden="true">G10 / TESTNET</div>
      <div className="intro-corner intro-corner-bottom" aria-hidden="true">SIGNED MARKOUT / DIRECTIONAL FEES</div>
    </div>
  );
}
