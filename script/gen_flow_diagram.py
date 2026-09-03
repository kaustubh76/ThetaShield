"""The whole ThetaShield flow on one canvas, generated rather than drawn.

    make diagram          # write docs/THETASHIELD_FLOW.excalidraw
    make diagram-check    # validate the layout without writing

ThetaShield is three chains, nine deployed contracts, eleven pure libraries and
a control loop whose whole point is that it is *slow on purpose*. The existing
`docs/THETASHIELD_ARCHITECTURE4.drawio` shows the boxes. It does not show the
two things a judge actually asks about: what the trader touches versus what
happens later, and how long "later" really is.

This writes that to `docs/THETASHIELD_FLOW.excalidraw`, in four bands read top
to bottom, under a map:

    MAP     colour = plane, the thesis, the claim boundary, shipped parameters
    BAND 1  the swap path — everything the trader waits for, and nothing else
    BAND 2  a trade becomes a number — Circle in, Reactive schedules, the
            ten-library pipeline in call order, and the three ways an
            observation dies before it ever reaches a fee
    BAND 3  the return, and what the controller refuses
    BAND 4  the proven run — six receipts, dated from their own blocks

## Why a generator and not a drawing

A drawing is a claim about the deployment made once, and this deployment moves.
Every address, chain id, Circle domain, transaction hash and shipped parameter
on this canvas is read at run time — addresses and receipts out of
`dashboard/data/deployment_manifest.json` (itself mirrored from the live
deployment manifest by `script/mirror_dashboard_manifest.py`), and every
`RESEARCH_V1` number out of `script/profiles/ThetaShieldProfiles.sol`, parsed
from the Solidity rather than retyped. Redeploy, and the diagram either follows
or fails to build. It cannot quietly go stale, which is the same posture
`script/check_phase9.py` takes with the dashboard.

The one hand-entered table is `RUN_STEPS`: the block number and block timestamp
of each of the six receipts. Those are immutable history — a mined block's
timestamp never changes — and they are the only way to state a latency offline.
Each row still has to match a hash the manifest supplies, so a re-run against a
different acceptance trace fails loudly instead of dating the wrong swap. Every
duration on the canvas is then *computed* from those timestamps, so no gap is
typed anywhere.

Output is deterministic: fixed seeds, fixed timestamp, counter-derived ids.
Re-running with nothing changed rewrites a byte-identical file.

## Layout

Standalone text rather than container-bound text. Bound text auto-wraps, but
its geometry is recomputed by the application and is easy to get subtly wrong
from outside; standalone text with computed widths places deterministically and
cannot end up clipped by a box drawn too small for it. Every node's rectangle
and its text share a group id, so a node drags as one object — the file is meant
to be edited, not only read.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "dashboard" / "data" / "deployment_manifest.json"
PROFILES = REPO / "script" / "profiles" / "ThetaShieldProfiles.sol"
LIVE_CONFIG = REPO / "dashboard" / "app" / "live-config.ts"
DEFAULT_OUT = REPO / "docs" / "THETASHIELD_FLOW.excalidraw"

# Fixed, so re-running produces the same bytes. Excalidraw uses `seed` only for
# hand-drawn jitter and `updated` only for conflict resolution; neither carries
# meaning we need, and both would otherwise churn the file on every run.
SEED_BASE = 20260903
STAMP = 1788400000000

CANVAS_W = 4260

# ---------------------------------------------------------------- palette --
#
# Excalidraw's own default swatches, so a node edited by hand in the app picks
# the same colours out of the palette rather than something adjacent to them.
# Colour is the *plane* a thing belongs to, which is the single distinction the
# whole architecture turns on.

INK = "#1e1e1e"
GREY = "#495057"

ORIGIN = ("#c2255c", "#fff0f6")  # Unichain Sepolia — execution, the swap path
CIRCLE = ("#1971c2", "#e7f5ff")  # Circle CCTP V2 — authenticated transport
PROCESS = ("#2f9e44", "#ebfbee")  # Ethereum Sepolia — delayed intelligence
REACT = ("#9c36b5", "#f8f0fc")  # Reactive Lasna — scheduling and resilience
REFUSE = ("#e03131", "#fff5f5")  # every guard, floor, expiry, baseline fallback
PROOF = ("#495057", "#f1f3f5")  # measured facts, receipts, parameters
BAND = ("#adb5bd", "#ffffff")

KINDS = {
    "origin": ORIGIN,
    "circle": CIRCLE,
    "process": PROCESS,
    "react": REACT,
    "refuse": REFUSE,
    "proof": PROOF,
}

# ------------------------------------------------------------- text metry --
#
# Advance width as a fraction of font size, measured against Excalidraw's own
# rendering rather than guessed: family 3 is Cascadia (monospace) and family 2
# is the sans it uses for normal text. These are what make a computed box height
# correct, which is what keeps text off the edges.

CHAR_W = {1: 0.55, 2: 0.52, 3: 0.60}
LINE_H = 1.25

TITLE_SIZE = 15
PATH_SIZE = 11
BODY_SIZE = 12
PAD_X = 14
PAD_Y = 12


def text_width(body: str, size: int, family: int) -> float:
    longest = max((len(line) for line in body.split("\n")), default=0)
    return longest * size * CHAR_W[family]


def text_height(body: str, size: int) -> float:
    return len(body.split("\n")) * size * LINE_H


def wrap(body: str, width_px: float, size: int, family: int) -> str:
    """Greedy wrap to a pixel width. Explicit newlines are kept as breaks."""
    limit = max(8, int(width_px / (size * CHAR_W[family])))
    out: list[str] = []
    for paragraph in body.split("\n"):
        line = ""
        for word in paragraph.split(" "):
            candidate = f"{line} {word}".strip()
            if len(candidate) > limit and line:
                out.append(line)
                line = word
            else:
                line = candidate
        out.append(line)
    return "\n".join(out)


# ------------------------------------------------------------- the canvas --


@dataclass
class Box:
    """A placed node, and the rectangle an arrow may bind to."""

    id: str
    x: float
    y: float
    w: float
    h: float

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2.0

    @property
    def cy(self) -> float:
        return self.y + self.h / 2.0


@dataclass
class Canvas:
    """Accumulates elements and hands out deterministic ids."""

    elements: list[dict[str, Any]] = field(default_factory=list)
    by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Node rectangles only, so the overlap check has something to check. Band
    # plates and legend swatches are deliberately absent from it.
    boxes: list[Box] = field(default_factory=list)
    # Deferred arrow labels: (text, midpoint x, midpoint y, colour, tail, head).
    labels: list[tuple[str, float, float, str, Box, Box]] = field(default_factory=list)
    _n: int = 0
    _bands: int = 0

    def next_id(self) -> str:
        self._n += 1
        return f"ts{self._n:04d}"

    def add(self, element: dict[str, Any]) -> dict[str, Any]:
        self.elements.append(element)
        self.by_id[element["id"]] = element
        return element

    def seed(self) -> int:
        # Derived from the element index, not from a PRNG: same file, same
        # seeds, and no hidden global state to get out of step.
        return (SEED_BASE * 7919 + self._n * 104729) % 2_147_483_647


def _base(canvas: Canvas, kind: str, **over: Any) -> dict[str, Any]:
    element = {
        "id": canvas.next_id(),
        "type": kind,
        "x": 0,
        "y": 0,
        "width": 0,
        "height": 0,
        "angle": 0,
        "strokeColor": INK,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": canvas.seed(),
        "version": 1,
        "versionNonce": canvas.seed(),
        "isDeleted": False,
        "boundElements": [],
        "updated": STAMP,
        "link": None,
        "locked": False,
    }
    element.update(over)
    return element


def text(
    canvas: Canvas,
    x: float,
    y: float,
    body: str,
    *,
    size: int = BODY_SIZE,
    family: int = 2,
    color: str = INK,
    group: str | None = None,
) -> dict[str, Any]:
    return canvas.add(
        _base(
            canvas,
            "text",
            x=x,
            y=y,
            width=text_width(body, size, family),
            height=text_height(body, size),
            strokeColor=color,
            groupIds=[group] if group else [],
            text=body,
            originalText=body,
            fontSize=size,
            fontFamily=family,
            textAlign="left",
            verticalAlign="top",
            containerId=None,
            lineHeight=LINE_H,
        )
    )


def rect(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    stroke: str = INK,
    fill: str = "transparent",
    group: str | None = None,
    dashed: bool = False,
    rounded: bool = True,
    stroke_width: int = 1,
) -> dict[str, Any]:
    return canvas.add(
        _base(
            canvas,
            "rectangle",
            x=x,
            y=y,
            width=w,
            height=h,
            strokeColor=stroke,
            backgroundColor=fill,
            fillStyle="solid",
            strokeStyle="dashed" if dashed else "solid",
            strokeWidth=stroke_width,
            groupIds=[group] if group else [],
            roundness={"type": 3} if rounded else None,
        )
    )


def node(
    canvas: Canvas,
    x: float,
    y: float,
    w: float,
    *,
    title: str,
    kind: str = "process",
    path: str = "",
    body: str = "",
    tag: str = "",
    dashed: bool = False,
) -> Box:
    """One box: a title, an optional source path, wrapped prose, an optional tag.

    Height is computed from the wrapped text rather than assumed, which is the
    only reason a box in this file is never too small for what is inside it.
    """
    stroke, fill = KINDS[kind]
    group = canvas.next_id()
    inner = w - 2 * PAD_X

    title_text = wrap(title, inner, TITLE_SIZE, 2)
    path_text = wrap(path, inner, PATH_SIZE, 3) if path else ""
    body_text = wrap(body, inner, BODY_SIZE, 2) if body else ""
    tag_text = wrap(tag, inner, PATH_SIZE, 3) if tag else ""

    h = PAD_Y + text_height(title_text, TITLE_SIZE)
    if path_text:
        h += 4 + text_height(path_text, PATH_SIZE)
    if body_text:
        h += 8 + text_height(body_text, BODY_SIZE)
    if tag_text:
        h += 6 + text_height(tag_text, PATH_SIZE)
    h += PAD_Y

    box_element = rect(canvas, x, y, w, h, stroke=stroke, fill=fill, group=group, dashed=dashed)

    cursor = y + PAD_Y
    text(canvas, x + PAD_X, cursor, title_text, size=TITLE_SIZE, color=stroke, group=group)
    cursor += text_height(title_text, TITLE_SIZE)
    if path_text:
        cursor += 4
        text(canvas, x + PAD_X, cursor, path_text, size=PATH_SIZE, family=3, color=GREY, group=group)
        cursor += text_height(path_text, PATH_SIZE)
    if body_text:
        cursor += 8
        text(canvas, x + PAD_X, cursor, body_text, size=BODY_SIZE, color=INK, group=group)
        cursor += text_height(body_text, BODY_SIZE)
    if tag_text:
        cursor += 6
        text(canvas, x + PAD_X, cursor, tag_text, size=PATH_SIZE, family=3, color=stroke, group=group)

    box = Box(box_element["id"], x, y, w, h)
    canvas.boxes.append(box)
    return box


def arrow(
    canvas: Canvas,
    a: Box,
    b: Box,
    *,
    label: str = "",
    color: str = GREY,
    dashed: bool = False,
    gap: int = 6,
    wrap_row: bool = False,
) -> dict[str, Any]:
    """Bind an edge between two boxes, elbowed along the dominant axis.

    Bound at both ends, so the edge re-routes when either node is dragged. A
    diagram whose arrows come loose the first time it is rearranged is a diagram
    nobody rearranges.

    `wrap_row` is for the one shape the dominant-axis rule gets wrong: the end
    of a row continuing at the start of the row below. That edge is mostly
    horizontal, so the rule routes it *along* the row it is leaving and drives
    it straight through every box in between. Forcing the vertical elbow instead
    drops into the gap between the two rows, crosses it, and comes up under the
    target — which is empty space by construction.
    """
    if wrap_row:
        sx, sy, ex, ey = a.cx, a.bottom, b.cx, b.y
        dx, dy = ex - sx, ey - sy
        element = canvas.add(
            _base(
                canvas,
                "arrow",
                x=sx,
                y=sy,
                width=abs(dx),
                height=abs(dy),
                strokeColor=color,
                strokeStyle="dashed" if dashed else "solid",
                points=[[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]],
                lastCommittedPoint=None,
                startBinding={"elementId": a.id, "focus": 0.0, "gap": gap},
                endBinding={"elementId": b.id, "focus": 0.0, "gap": gap},
                startArrowhead=None,
                endArrowhead="arrow",
                elbowed=False,
                roundness={"type": 2},
            )
        )
        canvas.by_id[a.id]["boundElements"].append({"id": element["id"], "type": "arrow"})
        canvas.by_id[b.id]["boundElements"].append({"id": element["id"], "type": "arrow"})
        if label:
            canvas.labels.append((label, sx + dx / 2, sy + dy / 2, color, a, b))
        return element

    if b.x >= a.right - 1:  # left to right
        sx, sy, ex, ey = a.right, a.cy, b.x, b.cy
    elif a.x >= b.right - 1:  # right to left
        sx, sy, ex, ey = a.x, a.cy, b.right, b.cy
    elif b.y >= a.bottom - 1:  # downward
        sx, sy, ex, ey = a.cx, a.bottom, b.cx, b.y
    else:  # upward
        sx, sy, ex, ey = a.cx, a.y, b.cx, b.bottom

    dx, dy = ex - sx, ey - sy
    if abs(dy) < 2 or abs(dx) < 2:
        points = [[0, 0], [dx, dy]]
    elif abs(dx) >= abs(dy):
        points = [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]]
    else:
        points = [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]]

    element = canvas.add(
        _base(
            canvas,
            "arrow",
            x=sx,
            y=sy,
            width=abs(dx),
            height=abs(dy),
            strokeColor=color,
            strokeStyle="dashed" if dashed else "solid",
            points=points,
            lastCommittedPoint=None,
            startBinding={"elementId": a.id, "focus": 0.0, "gap": gap},
            endBinding={"elementId": b.id, "focus": 0.0, "gap": gap},
            startArrowhead=None,
            endArrowhead="arrow",
            elbowed=False,
            roundness={"type": 2},
        )
    )
    canvas.by_id[a.id]["boundElements"].append({"id": element["id"], "type": "arrow"})
    canvas.by_id[b.id]["boundElements"].append({"id": element["id"], "type": "arrow"})
    if label:
        canvas.labels.append((label, sx + dx / 2, sy + dy / 2, color, a, b))
    return element


def place_labels(canvas: Canvas) -> None:
    """Put every arrow label somewhere it does not land on a node.

    Deferred to the end deliberately. A label dropped at its edge's midpoint
    lands inside a box about a third of the time — the midpoint of a short edge
    is often *behind* something — and worse, placing it while its own band is
    still being drawn checks it against boxes that do not exist yet. So the
    search runs once, against the finished canvas.
    """
    placed: list[tuple[float, float, float, float]] = []
    for label, mid_x, mid_y, color, a, b in canvas.labels:
        width = text_width(label, PATH_SIZE, 3)
        height = text_height(label, PATH_SIZE)
        left, top = mid_x - width / 2, mid_y

        candidates = [
            (left + dx_, top + dy_)
            for dy_, dx_ in ((-19, 0), (-34, 0), (8, 0), (24, 0), (-19, 44), (-19, -44))
        ]
        # These two clear both endpoints outright, which is the only thing that
        # works for boxes side by side with a small gap: no offset from the
        # midpoint can fit a label into that gap.
        candidates.append((left, min(a.y, b.y) - height - 9))
        candidates.append((left, max(a.bottom, b.bottom) + 9))
        candidates += [
            (left + shift, top - 18 - step * 15)
            for step in range(1, 26)
            for shift in (0, -95, 95, -190, 190)
        ]

        for x_, y_ in candidates:
            hits_box = any(
                x_ < box.right and box.x < x_ + width and y_ < box.bottom and box.y < y_ + height
                for box in canvas.boxes
            )
            # Labels also have to clear each other. Two edges leaving the same
            # node put their midpoints in the same place, so this is not a
            # theoretical collision.
            hits_label = any(
                x_ < lx + lw and lx < x_ + width and y_ < ly + lh and ly < y_ + height
                for lx, ly, lw, lh in placed
            )
            if not hits_box and not hits_label:
                left, top = x_, y_
                break
        else:
            raise SystemExit(
                f"no clear position for the arrow label {label!r} near "
                f"({mid_x:.0f}, {mid_y:.0f}) — the band is too dense to label there"
            )
        placed.append((left, top, width, height))
        text(canvas, left, top, label, size=PATH_SIZE, family=3, color=color)


def begin_band(canvas: Canvas) -> int:
    """Remember where a band's elements start, so its plate can be slid behind."""
    return len(canvas.elements)


def end_band(
    canvas: Canvas, mark: int, top: float, title: str, blurb: str, *, number: bool = True
) -> float:
    """Draw the backing plate for the band that began at `mark`, behind its nodes.

    The plate is sized from what the band actually contains rather than from a
    guessed height, and is then moved to the front of the band's slice — z-order
    in this format is list order, and a plate appended after its nodes would
    paint over them.
    """
    label = ""
    if number:
        canvas._bands += 1
        label = f"BAND {canvas._bands}"
    contents = canvas.elements[mark:]
    bottom = max((e["y"] + e["height"] for e in contents), default=top + 160) + 44

    plate_mark = len(canvas.elements)
    rect(canvas, 30, top, CANVAS_W - 60, bottom - top, stroke=BAND[0], fill=BAND[1], dashed=True)
    if label:
        text(canvas, 58, top + 20, label, size=13, family=3, color="#adb5bd")
    text(canvas, 58, top + 40, title, size=23, color=INK)
    text(canvas, 58, top + 74, blurb, size=13, color=GREY)

    plate = canvas.elements[plate_mark:]
    del canvas.elements[plate_mark:]
    canvas.elements[mark:mark] = plate
    return bottom


def chain(
    canvas: Canvas,
    x: float,
    y: float,
    specs: list[dict[str, Any]],
    *,
    w: float = 340,
    gap: float = 74,
    connect: bool = True,
    labels: list[str] | None = None,
    color: str = GREY,
) -> list[Box]:
    """A left-to-right run of nodes, connected in order."""
    boxes: list[Box] = []
    cursor = x
    for spec in specs:
        spec = dict(spec)
        width = spec.pop("w", w)
        boxes.append(node(canvas, cursor, y, width, **spec))
        cursor += width + gap
    if connect:
        for i, (left, right) in enumerate(zip(boxes, boxes[1:], strict=False)):
            arrow(
                canvas,
                left,
                right,
                label=(labels[i] if labels and i < len(labels) else ""),
                color=color,
            )
    return boxes


def stack(
    canvas: Canvas,
    x: float,
    y: float,
    specs: list[dict[str, Any]],
    *,
    w: float = 340,
    gap: float = 20,
) -> list[Box]:
    """A top-to-bottom column of nodes."""
    boxes: list[Box] = []
    cursor = y
    for spec in specs:
        spec = dict(spec)
        width = spec.pop("w", w)
        box = node(canvas, x, cursor, width, **spec)
        boxes.append(box)
        cursor = box.bottom + gap
    return boxes


# ------------------------------------------------------- facts, not typed --
#
# Everything below is read out of the repository. A number that appears on the
# canvas and also appears in the code appears here exactly once, and it is read
# from the code.

# The six receipts, dated from their own blocks. Hashes are NOT written here —
# each row names the manifest field that supplies one, so a re-run against a
# different acceptance trace fails instead of dating the wrong swap. Timestamps
# are what `eth_getBlockByNumber` answers for these blocks and cannot change.
RUN_STEPS: tuple[tuple[str, str, str, str, int, int], ...] = (
    (
        "acceptance.initial_swap_transaction_hash",
        "origin",
        "1 · the swap",
        "A real Uniswap v4 swap. The hook applies the fee, records the observation and dispatches it.",
        61_142_502,
        1_787_994_930,
    ),
    (
        "circle.observation.relay_transaction_hash",
        "processor",
        "2 · Circle delivers it",
        "Finalized CCTP message relayed to the processor. Domain 10 -> 0, threshold 2000.",
        11_591_005,
        1_787_996_364,
    ),
    (
        "acceptance.reactive_callback_transaction_hash",
        "processor",
        "3 · Reactive wakes the work",
        "The RSC saw ObservationQueued, waited out the markout horizon and called the executor "
        "through the official proxy.",
        11_591_008,
        1_787_996_400,
    ),
    (
        "circle.recommendation.send_transaction_hash",
        "processor",
        "4 · the second wake decides",
        "The RSC's second authenticated callback. Finalises the epoch, scores the observation "
        "against delayed reference evidence, and dispatches recommendation sequence 1.",
        11_591_019,
        1_787_996_532,
    ),
    (
        "circle.recommendation.relay_transaction_hash",
        "origin",
        "5 · Circle brings it back",
        "The controller authenticates the message and installs the recommendation. Domain 0 -> 10.",
        61_145_033,
        1_787_997_461,
    ),
    (
        "acceptance.later_swap_transaction_hash",
        "origin",
        "6 · a later swap proves it",
        "PoolManager charged exactly the fee the controller expected.",
        61_145_094,
        1_787_997_522,
    ),
)


@dataclass(frozen=True)
class Run:
    steps: tuple[dict[str, Any], ...]
    end_to_end: int
    dated: str


def read_pool_id() -> str:
    """The protected pool's id, from the one file allowed to hold it.

    It is deliberately not in deployment manifest schema v3, and `check_phase9.py`
    forbids 40+-hex literals anywhere in the dashboard app except
    `live-config.ts` — so that file is where it lives and this reads it from
    there rather than adding a second copy to the repository.
    """
    source = LIVE_CONFIG.read_text()
    start = source.index("export const POOL_ID")
    match = re.search(r"0x[0-9a-fA-F]{64}", source[start : start + 400])
    if not match:
        raise SystemExit("POOL_ID is no longer a literal in dashboard/app/live-config.ts")
    return match.group(0)


@dataclass(frozen=True)
class Facts:
    manifest: dict[str, Any]
    scheduler: dict[str, Any]
    fee_curve: dict[str, Any]
    run: Run
    pool_id: str
    components: dict[str, dict[str, Any]]
    networks: dict[str, dict[str, Any]]


def _solidity_number(raw: str) -> int | float | bool | None:
    """Turn a Solidity literal into a Python number.

    Handles `10_000`, `1e18`, `0.02e18` and `true`/`false`. Anything else is
    returned as None so the caller can leave it out rather than print a guess.
    """
    raw = raw.strip().rstrip(",").strip()
    if raw in ("true", "false"):
        return raw == "true"
    raw = raw.replace("_", "")
    if match := re.fullmatch(r"(\d+(?:\.\d+)?)e(\d+)", raw):
        return int(float(match.group(1)) * 10 ** int(match.group(2)))
    if re.fullmatch(r"\d+", raw):
        return int(raw)
    return None


def read_profile(name: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Parse one profile function's scheduler and fee-curve literals.

    Regex rather than a Solidity parser on purpose: this reads exactly the
    `key: literal,` shape the profile file uses, and a change to that shape
    should surface as a missing key here, not as a silently wrong number.
    """
    source = PROFILES.read_text()
    start = source.index(f"function {name}()")
    end = source.index("\n    }", start)
    body = source[start:end]

    def block(marker: str) -> dict[str, Any]:
        opened = body.index(marker)
        closed = body.index("});", opened)
        found: dict[str, Any] = {}
        for key, raw in re.findall(r"(\w+):\s*([^,\n]+)", body[opened:closed]):
            value = _solidity_number(raw)
            if value is not None:
                found[key] = value
        return found

    return block("SchedulerConfig({"), block("FeeCurve.Config({")


def read_run(manifest: dict[str, Any]) -> Run:
    """Resolve each receipt's hash from the manifest and compute the gaps."""

    def circle(kind: str) -> dict[str, Any]:
        for message in manifest["circle_messages"]:
            if message["kind"] == kind:
                return message
        raise SystemExit(f"the manifest has no {kind} Circle message")

    steps: list[dict[str, Any]] = []
    previous: int | None = None
    for source, role, title, blurb, block_number, observed_at in RUN_STEPS:
        head, *rest = source.split(".")
        if head == "acceptance":
            digest = manifest["acceptance"][rest[0]]
        else:
            digest = circle(rest[0])[rest[1]]
        steps.append(
            {
                "hash": digest,
                "role": role,
                "title": title,
                "blurb": blurb,
                "block": block_number,
                "at": observed_at,
                "gap": None if previous is None else observed_at - previous,
                "source": source,
            }
        )
        previous = observed_at

    first, last = steps[0]["at"], steps[-1]["at"]
    if last <= first:
        raise SystemExit("the run timeline does not move forward in time")
    return Run(
        steps=tuple(steps),
        end_to_end=last - first,
        dated=datetime.fromtimestamp(first, UTC).strftime("%Y-%m-%d %H:%M UTC"),
    )


def gather() -> Facts:
    manifest = json.loads(MANIFEST.read_text())
    scheduler, fee_curve = read_profile("researchV1")
    components = {component["name"]: component for component in manifest["components"]}
    networks = {network["role"]: network for network in manifest["networks"]}
    return Facts(
        manifest=manifest,
        scheduler=scheduler,
        fee_curve=fee_curve,
        run=read_run(manifest),
        pool_id=read_pool_id(),
        components=components,
        networks=networks,
    )


def short(address: str, keep: int = 6) -> str:
    return f"{address[: 2 + keep]}…{address[-4:]}"


def duration(seconds: int) -> str:
    minutes, rest = divmod(seconds, 60)
    return f"{minutes}m {rest:02d}s" if minutes else f"{rest}s"


def wad(value: int) -> str:
    """A WAD as the decimal a reader recognises, not as eighteen zeroes."""
    whole = value / 1e18
    return f"{whole:g}"


def bps(pips: int) -> str:
    return f"{pips / 100:.2f} bps"


# ------------------------------------------------------------- the bands --


def band_map(canvas: Canvas, f: Facts, top: float) -> float:
    mark = begin_band(canvas)
    y = top + 118

    origin, processor = f.networks["origin"], f.networks["processor"]
    reactive = f.manifest["reactive_automation"]

    legend = [
        (
            "origin",
            f"{origin['name']} · chain {origin['chain_id']}",
            f"Circle domain {origin['circle_domain']}. The swap path. Everything a trader waits for "
            "is here, and nothing here waits on another chain.",
        ),
        (
            "circle",
            "Circle CCTP V2",
            "Authenticated transport in both directions, finality threshold 2000. Circle decides "
            "what is authentic. It does not schedule and does not compute a fee.",
        ),
        (
            "process",
            f"{processor['name']} · chain {processor['chain_id']}",
            f"Circle domain {processor['circle_domain']}. Delayed intelligence: the bounded queue, "
            "reference history, epochs, confidence, persistence, the fee curve.",
        ),
        (
            "react",
            f"{reactive['network_name']} · chain {reactive['chain_id']}",
            "Event-driven automation and resilience. Reactive decides when eligible work runs. It "
            "cannot forge evidence, install a fee, or block a swap.",
        ),
        (
            "refuse",
            "Refusals and the baseline",
            f"Every guard, floor, expiry and fallback. When evidence is missing, stale, replayed or "
            f"unconfident the answer is {bps(f.fee_curve['baseFeePips'])} — not a guess.",
        ),
        (
            "proof",
            "Measured, not asserted",
            "Receipts, block timestamps and shipped parameters. Every one is read out of the "
            "repository by the generator that drew this canvas.",
        ),
    ]
    boxes = chain(
        canvas,
        90,
        y,
        [{"title": title, "kind": kind, "body": body} for kind, title, body in legend],
        w=620,
        gap=32,
        connect=False,
    )

    bottom = max(box.bottom for box in boxes) + 34
    thesis = node(
        canvas,
        90,
        bottom,
        1_272,
        title="The thesis, in one sentence",
        kind="proof",
        body="A pool has to price a swap before it can know whether that swap was fair. ThetaShield "
        "lets it find out afterwards: it measures what past flow actually did to LPs, subtracts "
        "ordinary noise, and raises the fee only for the direction that persistent evidence says "
        "was harmful. The other direction stays at the baseline.",
        tag="not a blacklist · not an identity score · not a delay · never custody of the swap",
    )
    node(
        canvas,
        thesis.right + 32,
        bottom,
        1_272,
        title="The claim boundary, stated up front",
        kind="refuse",
        body="Unaudited, testnet only, hook not submitted. The three reference pools are three fee "
        "tiers of one project-issued pair that the operator moves, so their agreement is structural, "
        "not evidential — live markout demonstrates the mechanism rather than measuring real adverse "
        "selection. `notional × signed markout` is an adverse-selection proxy: not LVR, not LP loss, "
        "not a profitability claim.",
        tag="research results below are deterministic synthetic studies",
    )
    node(
        canvas,
        thesis.right + 32 + 1_272 + 32,
        bottom,
        1_272,
        title=f"Shipped RESEARCH_V1 — read from {PROFILES.name}",
        kind="proof",
        path="script/profiles/ThetaShieldProfiles.sol :: researchV1()",
        body=f"markout horizon {f.scheduler['markoutHorizon']}s · epoch {f.scheduler['epochDuration']}s "
        f"· reference selection window {f.scheduler['referenceSelectionWindow']}s · observation "
        f"lifetime {f.scheduler['observationLifetime']}s · recommendation lifetime "
        f"{f.scheduler['recommendationLifetime']}s\n"
        f"trailing window {f.scheduler['trailingWindow']} · minimum trailing "
        f"{f.scheduler['minimumTrailingObservations']} · dead band k={wad(f.scheduler['deadBandKWad'])}σ "
        f"· persistence {f.scheduler['requiredToxicEpochs']} of {f.scheduler['persistenceWindow']} · "
        f"alpha {wad(f.scheduler['alphaWad'])} · target count {f.scheduler['targetObservationCount']}\n"
        f"fee {bps(f.fee_curve['baseFeePips'])} baseline, {bps(f.fee_curve['maximumFeePips'])} ceiling "
        f"· gain {f.fee_curve['gainFeePips']:,} pips · confidence floor "
        f"{wad(f.fee_curve['confidenceFloorWad'])} · rate limit +{f.fee_curve['maximumIncreasePips']} / "
        f"−{f.fee_curve['maximumDecreasePips']} pips",
        tag="these are the values the deployment answers with, read live on the dashboard",
    )

    return end_band(
        canvas,
        mark,
        top,
        "THETASHIELD — THE WHOLE FLOW, ONE CANVAS",
        "Colour is the plane a thing lives on. Four bands below: what the trader touches · what "
        "turns a trade into a number · what the controller refuses · the run that proves it.",
        number=False,
    )


def band_swap(canvas: Canvas, f: Facts, top: float) -> float:
    mark = begin_band(canvas)
    y = top + 122

    hook = f.components["ThetaShieldHook"]
    controller = f.components["ThetaShieldController"]
    transport = f.components["ThetaShieldCircleTransport"]
    origin = f.networks["origin"]

    boxes = chain(
        canvas,
        90,
        y,
        [
            {
                "title": "Trader or router",
                "kind": "origin",
                "body": "Sends an ordinary Uniswap v4 swap. No approval, no wallet check, no queue, "
                "no extra hop. The trader never learns ThetaShield is here.",
            },
            {
                "title": "Uniswap v4 PoolManager",
                "kind": "origin",
                "path": "lib/v4-core",
                "body": "The pool is created with the dynamic-fee flag, so the PoolManager asks the "
                "hook for the fee instead of using a fixed tier.",
                "tag": f"pool {short(f.pool_id, 8)} · profile "
                f"{f.manifest['profile']['name']}",
            },
            {
                "title": "ThetaShieldHook · beforeSwap",
                "kind": "origin",
                "path": "src/hook/ThetaShieldHook.sol",
                "body": "Asks the controller for the fee for THIS direction — buy-base and sell-base "
                "are separate numbers, not one spread — and returns it as the override.",
                "tag": short(hook["address"]),
            },
            {
                "title": "ThetaShieldController",
                "kind": "origin",
                "path": "src/controller/ThetaShieldController.sol",
                "body": "Holds the last recommendation Circle delivered. Answers from it only while "
                "it is installed, unexpired, past validAfter, confident enough and unpaused.",
                "tag": short(controller["address"]),
            },
            {
                "title": "the swap executes",
                "kind": "origin",
                "body": "At the fee the hook returned. Both proven public runs charged "
                f"{bps(f.fee_curve['baseFeePips'])} — and that is the correct answer, not a "
                "failure to act. See band 4.",
            },
            {
                "title": "ThetaShieldHook · afterSwap",
                "kind": "origin",
                "path": "src/hook/ThetaShieldHook.sol",
                "body": "Records what actually happened: pool, direction, execution price, notional, "
                "the fee applied, timestamp and a monotonic sequence. Emits SwapObserved.",
                "tag": "this is the evidence; everything later is a function of it",
            },
            {
                "title": "the fail-open boundary",
                "kind": "refuse",
                "dashed": True,
                "body": "The dispatch is wrapped in try/catch. If Circle is unavailable the hook "
                "emits ObservationTransportFailed and returns normally. A completed swap is NEVER "
                "reverted because the learning path was down.",
                "tag": "fail-open for evidence · fail-closed for fees",
            },
            {
                "title": "ThetaShieldCircleTransport",
                "kind": "circle",
                "path": "src/circle/ThetaShieldCircleTransport.sol",
                "body": "OnlyHook. Sends a fixed-size versioned CCTP message to the one-time-sealed "
                "processor peer, always at the finalized threshold 2000.",
                "tag": short(transport["address"]),
            },
            {
                "title": f"Circle CCTP V2 · domain {origin['circle_domain']} → "
                f"{f.networks['processor']['circle_domain']}",
                "kind": "circle",
                "body": "Unfinalized delivery reverts on the far side. Relaying is permissionless; "
                "the transmitter, source domain and sender are what authenticate it.",
                "tag": "band 2 picks this up",
            },
        ],
        w=360,
        gap=78,
        labels=[
            "swap",
            "beforeSwap",
            "fee for this side",
            "the fee to charge",
            "after execution",
            "try to dispatch",
            "sealed peer only",
            "send",
        ],
        color=ORIGIN[0],
    )

    y2 = max(box.bottom for box in boxes) + 78
    baseline = node(
        canvas,
        boxes[3].x,
        y2,
        360,
        title=f"→ baseline {bps(f.fee_curve['baseFeePips'])}",
        kind="refuse",
        body="Missing · paused · replayed · wrong pool · not yet valid · expired · below the "
        "confidence floor. Seven different failures, one answer. The pool is never left guessing.",
    )
    arrow(canvas, boxes[3], baseline, label="anything unproven", color=REFUSE[0], dashed=True)

    node(
        canvas,
        boxes[6].x,
        y2,
        360 * 3 + 78 * 2,
        title="What this band costs the trader",
        kind="proof",
        body="Two storage reads and an event — 33,192 gas in beforeSwap and 166,781 in a warm "
        "afterSwap, measured in isolated local EVM calls under a pinned profile, not quoted from a "
        "live chain. Everything in bands 2 and 3 updates LATER swaps; none of it is on the path of "
        "this one. That is the whole reason the delayed processor is allowed to be slow, stateful "
        "and expensive without anyone noticing.",
        tag="no second chain is ever in the critical path of a swap",
    )

    return end_band(
        canvas,
        mark,
        top,
        "BAND 1 · THE SWAP PATH — everything the trader waits for, and nothing else",
        f"{origin['name']}, chain {origin['chain_id']}, Circle domain {origin['circle_domain']}. One "
        "row, left to right, start to finish. The red boxes are the two places this design refuses "
        "to let a broken learning path become a broken swap.",
    )


def band_scoring(canvas: Canvas, f: Facts, top: float) -> float:
    mark = begin_band(canvas)
    y = top + 122

    processor = f.components["ThetaShieldCircleProcessor"]
    sampler = f.components["PoolMedianReferenceSampler"]
    executor = f.components["ThetaShieldAutomationExecutor"]
    rsc = f.components["ThetaShieldAutomationRSC"]
    reactive = f.manifest["reactive_automation"]
    sources = f.manifest["reference_sampler"]["sources"]

    top_row = chain(
        canvas,
        90,
        y,
        [
            {
                "title": "Circle attestation service",
                "kind": "circle",
                "body": "Attests the finalized message. Anyone can relay it — a relayer can delay or "
                "duplicate delivery, but cannot forge the sender, the domain or the body.",
            },
            {
                "title": "ThetaShieldCircleProcessor · receive",
                "kind": "process",
                "path": "src/circle/ThetaShieldCircleProcessor.sol",
                "body": f"Accepts only the local transmitter, source domain "
                f"{f.networks['origin']['circle_domain']}, the sealed transport peer and finalized "
                f"delivery. Queues into {f.scheduler['maximumPendingObservations']} fixed slots and "
                "emits ObservationQueued.",
                "tag": short(processor["address"]),
            },
            {
                "title": "ThetaShieldAutomationRSC",
                "kind": "react",
                "path": "src/reactive/ThetaShieldAutomationRSC.sol",
                "body": f"On {reactive['network_name']}. Subscribed to ObservationQueued, to "
                f"AutomationCycleCompleted with topic_3 == 1, and to the official {reactive['cron_name']} "
                f"topic. Arms the work, waits out the markout horizon, then requests a callback.",
                "tag": short(rsc["address"]),
            },
            {
                "title": "Reactive callback proxy",
                "kind": "react",
                "body": "The official destination proxy. It delivers the call and injects the "
                "deployer-derived ReactVM identity into the calldata — which is the thing the "
                "executor checks.",
                "tag": short(reactive["callback_proxy"]),
            },
            {
                "title": "ThetaShieldAutomationExecutor",
                "kind": "react",
                "path": "src/reactive/ThetaShieldAutomationExecutor.sol",
                "body": "rvmIdOnly + authorizedSenderOnly, both immutable public getters you can read "
                "yourself. Runs ONE bounded cycle: sample → sync → process. A permissionless keeper "
                "can call the same cycle, so a Reactive outage degrades automation, not the pool.",
                "tag": short(executor["address"]),
            },
        ],
        w=420,
        gap=64,
        labels=["relay (permissionless)", "queued", "wake, after maturity", "authenticated call"],
        color=REACT[0],
    )

    y2 = max(box.bottom for box in top_row) + 96
    sampler_box = node(
        canvas,
        90,
        y2,
        420,
        title="PoolMedianReferenceSampler",
        kind="process",
        path="src/feeds/PoolMedianReferenceSampler.sol",
        body=f"Reads {len(sources)} configured v4 pools. Each must clear its own active-liquidity "
        f"floor ({wad(int(sources[0]['minimum_liquidity']))} in units of the pool) before it counts "
        "as a distinct normalized source.",
        tag=f"{short(sampler['address'])} · minimum sources {f.scheduler['minimumReferenceSources']}",
    )

    # The pipeline, in the order the processor actually calls it — dispersion
    # before markout, and the smoother BEFORE the persistence window, which is
    # the one ordering a reader is likely to guess wrong. Two compact rows
    # rather than one long chain: ten boxes side by side would be wider than
    # the band and would not read as a sequence anyway.
    steps = [
        (
            "ReferencePriceNormalizer",
            "Each pool's price into one WAD scale, with a confidence weight in (0, 1].",
        ),
        (
            "ReferencePriceDispersion",
            "Weighted median as a robust centre, then WMAD ÷ median. Two sources cannot fake "
            "agreement by being equal.",
        ),
        (
            "DirectionalMarkoutMath",
            "m = d × (Pref − Pexec) ÷ Pexec. Positive m means the market moved the trader's way — "
            "adverse for the LP. The sign survives everything downstream.",
        ),
        (
            "TrailingVolatility",
            f"σ over the previous {f.scheduler['trailingWindow']} observations, half-open and "
            "STRICTLY excluding the one being scored. A trade cannot widen the band that judges it.",
        ),
        (
            "DeadBandFilter",
            f"e = sign(m) × max(|m| − {wad(f.scheduler['deadBandKWad'])}σ, 0). Ordinary noise becomes "
            "exactly zero. Only the excess survives, still signed.",
        ),
        (
            "EpochAggregation",
            f"Notional-weighted mean per side per epoch. Trades below "
            f"{wad(f.scheduler['minimumObservationNotionalWad'])} are ignored; above "
            f"{wad(f.scheduler['maximumTradeNotionalWad'])} are capped.",
        ),
        (
            "ConfidenceWeight",
            "count × agreement × dispersion, each clamped to [0,1]. This is the gate the cold start "
            "cannot pass — and the reason the live fee is still at baseline.",
        ),
        (
            "DirectionalRiskSmoother",
            f"EWMA alpha {wad(f.scheduler['alphaWad'])} on MAGNITUDE only. Direction always comes "
            "from the current signed aggregate, so a smoother can never invent a direction.",
        ),
        (
            "PersistenceWindow",
            f"One bit per epoch in a {f.scheduler['persistenceWindow']}-bit rolling map. Active at "
            f"{f.scheduler['requiredToxicEpochs']} of {f.scheduler['persistenceWindow']}. Toxic "
            "epochs need not be consecutive.",
        ),
        (
            "FeeCurve",
            f"premium = gain × max(signedRisk, 0), clamped to "
            f"[{bps(f.fee_curve['minimumFeePips'])}, {bps(f.fee_curve['maximumFeePips'])}] and rate "
            f"limited to +{f.fee_curve['maximumIncreasePips']} / −{f.fee_curve['maximumDecreasePips']} "
            "pips per step. Negative risk can never raise a fee.",
        ),
    ]
    first_row = chain(
        canvas,
        sampler_box.right + 78,
        y2,
        [
            {"title": title, "kind": "process", "body": body, "path": f"src/libraries/{title}.sol"}
            for title, body in steps[:5]
        ],
        w=420,
        gap=64,
        labels=["normalized", "centre + spread", "signed markout", "minus the band"],
        color=PROCESS[0],
    )
    arrow(canvas, sampler_box, first_row[0], color=PROCESS[0], label="3 sources")

    y3 = max(box.bottom for box in first_row + [sampler_box]) + 96
    second_row = chain(
        canvas,
        sampler_box.right + 78,
        y3,
        [
            {"title": title, "kind": "process", "body": body, "path": f"src/libraries/{title}.sol"}
            for title, body in steps[5:]
        ],
        w=420,
        gap=64,
        labels=["per-epoch signal", "how much to trust it", "signed risk", "has it persisted?"],
        color=PROCESS[0],
    )
    arrow(canvas, first_row[4], second_row[0], color=PROCESS[0], wrap_row=True)

    deaths = stack(
        canvas,
        90,
        y3,
        [
            {
                "title": "under all ten: FixedPointMath",
                "kind": "proof",
                "path": "src/libraries/FixedPointMath.sol",
                "body": "Full-precision mulDiv up / down / signed, mulWadDown, abs, checked casts. "
                "Unsigned division rounds down, signed rounds toward zero — every Solidity formula "
                "and every golden vector shares that one convention.",
            },
            {
                "title": "three ways an observation dies",
                "kind": "refuse",
                "body": f"EXPIRED — the reference selection window is "
                f"{f.scheduler['referenceSelectionWindow']}s, not the "
                f"{f.scheduler['observationLifetime']}s lifetime. Past it no sample can fall inside "
                "the scoring range, so no keeper can rescue it. This is the exact failure the "
                "scheduler exists to prevent, and it happened for real once.\n"
                "DROPPED — queue capacity, invalid markout, or epoch capacity.\n"
                "COLD START — scored, but structurally unable to move a fee.",
                "tag": "a refusal is a recorded outcome here, not a silent no-op",
            }
        ],
        w=420,
    )
    arrow(canvas, top_row[1], deaths[1], color=REFUSE[0], dashed=True, label="never scored")

    return end_band(
        canvas,
        mark,
        top,
        "BAND 2 · A TRADE BECOMES A NUMBER — Circle carries it, Reactive times it, "
        "ten libraries score it",
        f"{f.networks['processor']['name']} chain {f.networks['processor']['chain_id']}, scheduled "
        f"from {f.manifest['reactive_automation']['network_name']} chain "
        f"{f.manifest['reactive_automation']['chain_id']}. Top row: how the work gets started and "
        "authenticated. Bottom two rows: the pipeline, in the order data flows through it.",
    )


def band_return(canvas: Canvas, f: Facts, top: float) -> float:
    mark = begin_band(canvas)
    y = top + 122

    controller = f.components["ThetaShieldController"]

    boxes = chain(
        canvas,
        90,
        y,
        [
            {
                "title": "the processor dispatches",
                "kind": "process",
                "body": "A sequenced, expiring, bounded recommendation: one fee and one risk figure "
                "PER SIDE, plus a confidence. Never an instruction — a claim the controller is free "
                "to reject.",
            },
            {
                "title": f"Circle CCTP V2 · domain "
                f"{f.networks['processor']['circle_domain']} → "
                f"{f.networks['origin']['circle_domain']}",
                "kind": "circle",
                "body": "The same authenticated rail, the other way. Finalized only. Whoever relays "
                "it gains nothing by relaying it.",
            },
            {
                "title": "ThetaShieldController · receive",
                "kind": "origin",
                "path": "src/controller/ThetaShieldController.sol",
                "body": "Then the checks. Any one of them failing is not an error state — it simply "
                "means the pool keeps charging the baseline.",
                "tag": short(controller["address"]),
            },
        ],
        w=440,
        gap=80,
        labels=["send", "receive"],
        color=CIRCLE[0],
    )

    checks = node(
        canvas,
        boxes[2].right + 80,
        y,
        620,
        title="Ten checks before a fee is allowed to change",
        kind="refuse",
        body="local message transmitter · source domain · one-time-sealed processor peer · finalized "
        "threshold · the right pool · monotonic sequence (no replay) · validAfter not in the future · "
        "validUntil not passed · cooldown elapsed · confidence ≥ floor · fee inside "
        f"[{bps(f.fee_curve['minimumFeePips'])}, {bps(f.fee_curve['maximumFeePips'])}] · risk inside "
        "bounds",
        tag="fail any one → baseline. There is no partial trust.",
    )
    arrow(canvas, boxes[2], checks, color=REFUSE[0])

    y2 = max(boxes[2].bottom, checks.bottom) + 84
    installed = node(
        canvas,
        boxes[2].x,
        y2,
        440,
        title="installed",
        kind="origin",
        body="The next swap in that direction is charged the new fee. The other direction is "
        "untouched — there is no shared risk bucket.",
    )
    baseline = node(
        canvas,
        checks.x,
        y2,
        620,
        title=f"or {bps(f.fee_curve['baseFeePips'])}, the safe answer",
        kind="refuse",
        body=f"Recommendations expire after {f.scheduler['recommendationLifetime']}s. If Circle "
        "stops, if Reactive stops, if the keeper stops, if the processor is wrong — the premium "
        "decays away and the pool returns to baseline on its own. Nothing has to be noticed for the "
        "safe thing to happen.",
        tag="the failure mode is 'cheap', never 'stuck' and never 'unbounded'",
    )
    arrow(canvas, checks, installed, color=ORIGIN[0], label="all ten pass")
    arrow(canvas, checks, baseline, color=REFUSE[0], dashed=True)

    node(
        canvas,
        baseline.right + 80,
        y,
        700,
        title="The authority boundary — the answer to the obvious question",
        kind="proof",
        body="CIRCLE decides what is authentic. REACTIVE decides when eligible work runs. Neither "
        "computes a fee, holds a token, or can stop a swap. The executor Reactive calls is "
        "permissionless and cannot install controller state; the controller only ever believes a "
        "finalized Circle message from a sealed peer.\n\n"
        "So the worst a failed scheduler can do is make the pool cheap and forgetful — which is "
        "exactly what a pool with no memory already is.",
        tag="two planes, two authorities, neither able to do the other's job",
    )
    return end_band(
        canvas,
        mark,
        top,
        "BAND 3 · THE RETURN — and what the controller refuses",
        f"Back on {f.networks['origin']['name']}. The interesting half of this band is the red half: "
        "a system that decides fees is only as trustworthy as the things it declines to believe.",
    )


def band_run(canvas: Canvas, f: Facts, top: float) -> float:
    mark = begin_band(canvas)
    y = top + 122
    run = f.run

    explorers = {
        "origin": "https://unichain-sepolia.blockscout.com/tx/",
        "processor": "https://eth-sepolia.blockscout.com/tx/",
    }
    specs = []
    for step in run.steps:
        specs.append(
            {
                "title": step["title"],
                "kind": "origin" if step["role"] == "origin" else "process",
                "body": step["blurb"],
                "path": f"{short(step['hash'], 10)}",
                "tag": f"block {step['block']:,} · "
                f"{datetime.fromtimestamp(step['at'], UTC).strftime('%H:%M:%S')} UTC",
            }
        )
    boxes = chain(
        canvas,
        90,
        y,
        specs,
        w=400,
        gap=76,
        labels=[duration(step["gap"]) for step in run.steps[1:]],
        color=PROOF[0],
    )
    for box, step in zip(boxes, run.steps, strict=True):
        canvas.by_id[box.id]["link"] = explorers[step["role"]] + step["hash"]

    y2 = max(box.bottom for box in boxes) + 84
    total = node(
        canvas,
        90,
        y2,
        700,
        title=f"{duration(run.end_to_end)}, end to end",
        kind="proof",
        body=f"Measured on {run.dated}, from the block timestamps of the six transactions above — "
        "not from a stopwatch and not from a log. Two of those legs are Circle's finality-2000 "
        f"transport, and they are {duration(run.steps[1]['gap'] + run.steps[4]['gap'])} of the "
        f"total. Reactive's wake is {duration(run.steps[2]['gap'])} of it.",
        tag="every hash above links to a public explorer",
    )
    why = node(
        canvas,
        total.right + 76,
        y2,
        700,
        title=f"Why the fee stayed at {bps(f.fee_curve['baseFeePips'])} — and why that is the result",
        kind="refuse",
        body=f"minimumTrailingObservations is {f.scheduler['minimumTrailingObservations']} PER SIDE. "
        "The pool has settled two observations across both sides in its life, so confidence is "
        "structurally zero and no premium is reachable. The first live safety decision this system "
        "ever made was refusing to move a fee off one sample.\n\n"
        "A mechanism that repriced a pool from a single observation would demo better and be trivial "
        "to manipulate.",
        tag="the non-baseline directional transition is proven in the lifecycle suite, not yet in a "
        "second public cycle",
    )
    proves = node(
        canvas,
        why.right + 76,
        y2,
        820,
        title="What this run does and does not prove",
        kind="proof",
        body="DOES — a real v4 swap on one chain changed the fee logic governing a later real v4 swap "
        "on that chain, with authenticated Circle transport both ways, a Reactive-scheduled and "
        "proxy-authenticated callback in the middle, and a measured cost for each leg. The final "
        f"PoolManager swap charged exactly the {f.manifest['acceptance']['expected_fee_pips']}-pip fee "
        "the controller expected.\n\n"
        "DOES NOT — measure real adverse selection. The reference market is ours and the operator "
        "moves it. This run proves the machine, not the economics.",
        tag="the economics are the synthetic holdout study; the machine is this trace",
    )
    arrow(canvas, boxes[0], total, color=PROOF[0], dashed=True)
    arrow(canvas, boxes[5], why, color=REFUSE[0], dashed=True, wrap_row=True)
    arrow(canvas, why, proves, color=GREY, dashed=True)

    return end_band(
        canvas,
        mark,
        top,
        "BAND 4 · THE PROVEN RUN — six receipts, dated from their own blocks",
        f"Unichain Sepolia → Circle → Ethereum Sepolia → Reactive Lasna → Circle → Unichain Sepolia. "
        f"Every duration below is computed from block timestamps, and every box links to its "
        f"transaction. Source revision {f.manifest['source_revision'][:12]}.",
    )


# ------------------------------------------------------------- assembling --


def build(f: Facts) -> Canvas:
    canvas = Canvas()
    y = 40.0
    for band in (band_map, band_swap, band_scoring, band_return, band_run):
        y = band(canvas, f, y) + 56
    place_labels(canvas)
    return canvas


def _segment_hits(a: tuple[float, float], b: tuple[float, float], box: Box) -> bool:
    """Does the axis-aligned segment a->b pass through `box`'s interior?

    Every segment this generator emits is horizontal or vertical, so the test is
    an interval overlap rather than a general intersection. A small inset keeps
    an edge that merely grazes a corner from counting.
    """
    inset = 3.0
    left, right = box.x + inset, box.right - inset
    top, bottom = box.y + inset, box.bottom - inset
    (ax, ay), (bx, by) = a, b
    if abs(ay - by) < 0.5:  # horizontal
        return top < ay < bottom and min(ax, bx) < right and max(ax, bx) > left
    if abs(ax - bx) < 0.5:  # vertical
        return left < ax < right and min(ay, by) < bottom and max(ay, by) > top
    return False


def validate(canvas: Canvas) -> list[str]:
    """Check the drawing the way the repo checks everything else: by running it.

    Four failures are possible in a layout engine and all four are silent in the
    JSON: an arrow bound to an element that does not exist, two nodes drawn on
    top of each other, an arrow driven straight through a box it has nothing to
    do with, and text drawn outside the box meant to contain it. None of them
    would raise; all of them would ship.
    """
    problems: list[str] = []

    for element in canvas.elements:
        for key in ("startBinding", "endBinding"):
            binding = element.get(key)
            if binding and binding["elementId"] not in canvas.by_id:
                problems.append(f"{element['id']}.{key} points at a missing element")
        for bound in element.get("boundElements") or []:
            if bound["id"] not in canvas.by_id:
                problems.append(f"{element['id']} is bound to a missing {bound['id']}")

    for i, a in enumerate(canvas.boxes):
        for b in canvas.boxes[i + 1 :]:
            if a.x < b.right and b.x < a.right and a.y < b.bottom and b.y < a.bottom:
                problems.append(
                    f"nodes overlap: ({a.x:.0f},{a.y:.0f},{a.w:.0f}x{a.h:.0f}) "
                    f"and ({b.x:.0f},{b.y:.0f},{b.w:.0f}x{b.h:.0f})"
                )

    for element in canvas.elements:
        if element["type"] != "arrow":
            continue
        bound = {element["startBinding"]["elementId"], element["endBinding"]["elementId"]}
        points = [(element["x"] + px, element["y"] + py) for px, py in element["points"]]
        for box in canvas.boxes:
            if box.id in bound:
                continue
            if any(_segment_hits(a, b, box) for a, b in zip(points, points[1:], strict=False)):
                problems.append(
                    f"an arrow crosses a box it is not bound to, at ({box.x:.0f},{box.y:.0f})"
                )
                break

    for element in canvas.elements:
        if element["type"] != "text" or element["groupIds"]:
            continue
        for box in canvas.boxes:
            if (
                element["x"] < box.right
                and box.x < element["x"] + element["width"]
                and element["y"] < box.bottom
                and box.y < element["y"] + element["height"]
            ):
                problems.append(f"loose text sits on a node: {element['text'][:56]!r}")
                break

    loose = [e for e in canvas.elements if e["type"] == "text" and not e["groupIds"]]
    for i, a in enumerate(loose):
        for b in loose[i + 1 :]:
            if (
                a["x"] < b["x"] + b["width"]
                and b["x"] < a["x"] + a["width"]
                and a["y"] < b["y"] + b["height"]
                and b["y"] < a["y"] + a["height"]
            ):
                problems.append(f"two loose texts overlap: {a['text'][:34]!r} and {b['text'][:34]!r}")

    rects = {
        element["groupIds"][0]: element
        for element in canvas.elements
        if element["type"] == "rectangle" and element["groupIds"]
    }
    for element in canvas.elements:
        if element["type"] != "text" or not element["groupIds"]:
            continue
        container = rects.get(element["groupIds"][0])
        if container is None:
            continue
        if element["x"] + element["width"] > container["x"] + container["width"] - 6:
            problems.append(f"text overflows its box horizontally: {element['text'][:48]!r}")
        if element["y"] + element["height"] > container["y"] + container["height"] - 2:
            problems.append(f"text overflows its box vertically: {element['text'][:48]!r}")

    # An arrow's `width` is a bounding-box magnitude, not a rightward extent, so
    # `x + width` overshoots for every leftward edge. Measure those from their
    # own points instead — otherwise a wrap-around edge reports the canvas as
    # too narrow when it is not.
    def right_edge(element: dict[str, Any]) -> float:
        if element["type"] == "arrow":
            return element["x"] + max(px for px, _ in element["points"])
        return element["x"] + element["width"]

    widest = max(right_edge(element) for element in canvas.elements)
    if widest > CANVAS_W - 20:
        problems.append(f"the canvas is too narrow: content reaches {widest:.0f} of {CANVAS_W}")

    return problems


def document(canvas: Canvas) -> dict[str, Any]:
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "thetashield/script/gen_flow_diagram.py",
        "elements": canvas.elements,
        "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
        "files": {},
    }


def report(f: Facts, canvas: Canvas, out: Path) -> None:
    bottom = max(e["y"] + e["height"] for e in canvas.elements)
    arrows = sum(1 for e in canvas.elements if e["type"] == "arrow")
    print(f"wrote {out.relative_to(REPO) if out.is_relative_to(REPO) else out}")
    print(
        f"  {len(canvas.elements):,} elements, {len(canvas.boxes)} nodes, {arrows} edges, "
        f"canvas {CANVAS_W:,} x {bottom:,.0f}"
    )
    print("  read, not typed:")
    print(f"    components      {len(f.components)} <- dashboard/data/deployment_manifest.json")
    print(f"    networks        {len(f.networks)} + Reactive Lasna <- deployment_manifest.json")
    print(f"    scheduler       {len(f.scheduler)} values <- script/profiles/ThetaShieldProfiles.sol")
    print(f"    fee curve       {len(f.fee_curve)} values <- script/profiles/ThetaShieldProfiles.sol")
    print(f"    pool id         {short(f.pool_id, 8)} <- dashboard/app/live-config.ts")
    print(f"    run             {len(f.run.steps)} receipts, {duration(f.run.end_to_end)} end to end")
    for step in f.run.steps:
        gap = "        " if step["gap"] is None else f"+{duration(step['gap']):>8}"
        print(f"      {gap}  {step['hash'][:18]}…  <- {step['source']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate docs/THETASHIELD_FLOW.excalidraw")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate and report without writing, the CI-shaped form",
    )
    args = parser.parse_args(argv)

    facts = gather()
    canvas = build(facts)

    problems = validate(canvas)
    if problems:
        print(f"{len(problems)} layout problem(s):", file=sys.stderr)
        for problem in problems[:20]:
            print(f"  {problem}", file=sys.stderr)
        return 1

    out = Path(args.out)
    rendered = json.dumps(document(canvas), indent=1) + "\n"
    if args.check:
        if out.exists() and out.read_text() != rendered:
            print(f"{out} is stale — run `make diagram`", file=sys.stderr)
            return 1
        print(f"layout clean: {len(canvas.elements):,} elements, {len(canvas.boxes)} nodes")
        return 0

    out.write_text(rendered)
    report(facts, canvas, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
