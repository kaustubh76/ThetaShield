// One list of control-loop phases, shared by the animated journey and the
// receipt trail. Each previously kept its own copy of these labels and joined on
// exact string equality, so a rename in either file silently emptied the
// journey's receipt strip — indistinguishable from the two phases that legitimately
// carry no receipt. Keying on an id makes that a compile error instead.
//
// `network` is resolved from the deployment manifest at render time for the three
// real chains. Circle is a transport protocol rather than a chain, so it has no
// manifest entry and names itself.
export const JOURNEY_PHASES = [
  { id: "swap-path", label: "Swap path", lane: "origin", network: "origin" },
  { id: "evidence-outbound", label: "Evidence outbound", lane: "circle", network: "CIRCLE CCTP V2" },
  { id: "queue-evidence", label: "Queue evidence", lane: "processor", network: "processor" },
  { id: "autonomous-wake", label: "Autonomous wake", lane: "reactive", network: "reactive" },
  { id: "delayed-analysis", label: "Delayed analysis", lane: "processor", network: "processor" },
  { id: "recommendation-return", label: "Recommendation return", lane: "circle", network: "CIRCLE CCTP V2" },
  { id: "apply-next-fee", label: "Apply next fee", lane: "origin", network: "origin" },
] as const;

export type JourneyPhaseId = (typeof JOURNEY_PHASES)[number]["id"];
