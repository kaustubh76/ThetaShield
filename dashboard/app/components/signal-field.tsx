"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";

// Density-driven rather than a fixed count, so a 4K display does not read as
// empty and a phone does not read as crowded.
const AREA_PER_POINT = 26000;
const MIN_POINTS = 16;
const MAX_POINTS = 54;

// Peak alpha is an accessibility budget, not a taste call. It applies to the
// very centre of a point, the only pixel that can sit at full strength behind a
// glyph. The section grounds keep 72% opacity (--veil in globals.css), so 0.34
// composites to about 0.095 over --ink in that worst case, which leaves the two
// text colours that can land on it at --dim 4.58:1 and --muted 5.88:1 — both
// clear of WCAG AA. This is the ceiling: 0.36 puts --dim on the 4.5 line.
//
// That budget only exists because --dim was lifted to #7a8f86; against the old
// #60756d no value here was passing, and every increment came out of text that
// already failed. Re-check both ratios before raising this or lowering --veil.
//
// Points are drawn as soft glows rather than hard dots because of the same
// ceiling: presence scales with area, but worst-case contrast is set by peak
// alpha alone, so a wide halo buys visibility that more alpha cannot.
const MIN_POINT_ALPHA = 0.1;
const MAX_POINT_ALPHA = 0.34;
const MIN_GLOW_RADIUS = 5;
const MAX_GLOW_RADIUS = 16;
const SPRITE_SIZE = 128;

const LINK_DISTANCE = 130;
const LINK_ALPHA = 0.085;

// At ~5px/s a point travels 0.17px per frame at 30fps — subpixel, so 60fps costs
// twice as much to render motion the eye cannot resolve.
const FRAME_MS = 1000 / 30;
const MAX_DPR = 2;

// The stylesheet spells these palette entries out as raw triplets too (--signal
// and --violet are hex, so they cannot carry an alpha), so this matches rather
// than introducing a second way to say the same colour.
const MINT = "128,255,178";
const VIOLET = "158,145,255";

type Point = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // One value drives radius, alpha and speed together. That coupling is what
  // makes the field read as depth instead of as a flat scatter of dots.
  depth: number;
  phase: number;
  period: number;
  colour: string;
};

// One pre-rendered glow per palette entry. Building a radial gradient per point
// per frame would mean ~54 gradient allocations every frame; blitting a cached
// sprite is a single drawImage each.
function makeGlow(colour: string): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;

  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const mid = SPRITE_SIZE / 2;
  const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  // A tight core inside a wide, fast-falling halo: the core is what reads as a
  // point, the halo is what makes the field feel like depth rather than confetti.
  gradient.addColorStop(0, `rgba(${colour},1)`);
  gradient.addColorStop(0.18, `rgba(${colour},.45)`);
  gradient.addColorStop(0.45, `rgba(${colour},.1)`);
  gradient.addColorStop(1, `rgba(${colour},0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return sprite;
}

function targetCount(width: number, height: number): number {
  return Math.max(MIN_POINTS, Math.min(MAX_POINTS, Math.round((width * height) / AREA_PER_POINT)));
}

function makePoint(width: number, height: number, index: number): Point {
  const depth = 0.35 + Math.random() * 0.65;
  const heading = Math.random() * Math.PI * 2;
  const speed = 2.5 + depth * 5;

  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: Math.cos(heading) * speed,
    vy: Math.sin(heading) * speed,
    depth,
    phase: Math.random() * Math.PI * 2,
    period: 6 + Math.random() * 8,
    // Roughly one in seven violet, echoing the simulated/research lane that the
    // rest of the page already uses --violet for.
    colour: index % 7 === 3 ? VIOLET : MINT,
  };
}

function advance(points: Point[], width: number, height: number, dt: number) {
  // Wrapping past a margin rather than at the edge, so the reappearance happens
  // outside the frame. The canvas mask fades the border anyway.
  const margin = 24;

  for (const point of points) {
    point.x += point.vx * dt;
    point.y += point.vy * dt;

    if (point.x < -margin) point.x = width + margin;
    else if (point.x > width + margin) point.x = -margin;

    if (point.y < -margin) point.y = height + margin;
    else if (point.y > height + margin) point.y = -margin;
  }
}

function paint(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  height: number,
  seconds: number,
  glows: Record<string, HTMLCanvasElement>,
) {
  ctx.clearRect(0, 0, width, height);

  // Threads first, so every dot sits on top of its own links.
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance >= LINK_DISTANCE) continue;

      // Quadratic falloff keeps the field self-sparsifying: only genuinely close
      // pairs stay visible, so you see a thread form and dissolve rather than a
      // permanent web.
      const fade = (1 - distance / LINK_DISTANCE) ** 2;
      ctx.strokeStyle = `rgba(${a.colour},${LINK_ALPHA * fade * Math.min(a.depth, b.depth)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const point of points) {
    // Per-point phase and period, so the field shimmers as a whole without any
    // single dot pulsing hard enough to draw the eye.
    const breathe = 0.75 + 0.25 * Math.sin((seconds / point.period) * Math.PI * 2 + point.phase);
    const alpha = (MIN_POINT_ALPHA + point.depth * (MAX_POINT_ALPHA - MIN_POINT_ALPHA)) * breathe;
    const radius = MIN_GLOW_RADIUS + point.depth * (MAX_GLOW_RADIUS - MIN_GLOW_RADIUS);

    ctx.globalAlpha = alpha;
    ctx.drawImage(glows[point.colour], point.x - radius, point.y - radius, radius * 2, radius * 2);
  }

  ctx.globalAlpha = 1;
}

// The ambient background for the whole product: a sparse drifting point field,
// mounted once in the root layout behind every route.
export default function SignalField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;

    // Re-aliased with explicit types: the helpers below are hoisted function
    // declarations, which TypeScript type-checks against the pre-guard nullable
    // types rather than the narrowed ones.
    const canvas: HTMLCanvasElement = element;
    const ctx: CanvasRenderingContext2D = context;
    const glows: Record<string, HTMLCanvasElement> = { [MINT]: makeGlow(MINT), [VIOLET]: makeGlow(VIOLET) };

    let width = 0;
    let height = 0;
    let points: Point[] = [];
    let frame = 0;
    let resizeTimer = 0;
    let lastFrame = 0;
    let elapsed = 0;

    function measure() {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      canvas.width = Math.round(nextWidth * dpr);
      canvas.height = Math.round(nextHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = targetCount(nextWidth, nextHeight);

      if (points.length === 0) {
        points = Array.from({ length: target }, (_, index) => makePoint(nextWidth, nextHeight, index));
      } else {
        // Rescale rather than re-seed. The launch intro locks body overflow for
        // ~2.8s, which toggles the scrollbar twice and fires two ~15px resizes;
        // re-seeding on those would visibly scatter the field mid-intro. The
        // ±4 deadband keeps mobile URL-bar jitter from churning the count too.
        const scaleX = width ? nextWidth / width : 1;
        const scaleY = height ? nextHeight / height : 1;
        for (const point of points) {
          point.x *= scaleX;
          point.y *= scaleY;
        }
        while (points.length > target + 4) points.pop();
        while (points.length < target - 4) points.push(makePoint(nextWidth, nextHeight, points.length));
      }

      width = nextWidth;
      height = nextHeight;
    }

    function render(now: number) {
      frame = requestAnimationFrame(render);

      const delta = now - lastFrame;
      if (delta < FRAME_MS) return;
      lastFrame = now - (delta % FRAME_MS);

      // Clamped so a tab that was throttled or backgrounded resumes drifting
      // instead of teleporting the whole field on its first frame back.
      const dt = Math.min(delta, 250) / 1000;
      elapsed += dt;

      advance(points, width, height, dt);
      paint(ctx, points, width, height, elapsed, glows);
    }

    function start() {
      if (frame) return;
      lastFrame = performance.now();
      frame = requestAnimationFrame(render);
    }

    function stop() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }

    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        measure();
        // The animated path repaints on its own; the still one has to be asked.
        if (reducedMotion) paint(ctx, points, width, height, elapsed, glows);
      }, 150);
    }

    measure();

    if (reducedMotion) {
      // Reduced motion means no animation, not no visuals — a single static
      // frame keeps the depth the design relies on. (The launch intro removes
      // itself outright instead, but it is a timed sequence with no still
      // state to fall back to; a point field has one.)
      paint(ctx, points, width, height, 0, glows);
    } else {
      start();
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    window.addEventListener("resize", onResize);

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="signal-field" aria-hidden="true" />;
}
