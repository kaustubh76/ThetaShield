# Phase 8B Handoff — Circle Contracts and Local Lifecycle

> Historical record: the statement that the control path no longer depends on
> Reactive Network was true at Phase 8B. G6 restored a Reactive Legacy Lasna
> scheduler, and the live G10 deployment uses it for bounded automation.

## Outcome

ThetaShield's deployable control path no longer depends on Reactive Network,
Lasna, `IReactive`, an RVM identifier, a callback proxy, CRON subscriptions, or
lREACT funding. The replacement uses Circle CCTP V2 finalized generic messages
in both directions while retaining ThetaShield's bounded delayed computation.

## Contracts

- `CircleMessages` defines exact versioned observation and recommendation
  payloads with fixed encoded lengths.
- `ThetaShieldCircleTransport` authenticates the hook and dispatches finalized
  observation messages from the origin domain.
- `ThetaShieldCircleProcessor` authenticates Circle, the source domain, and the
  source transport; pulls readings from the configured feed; advances bounded
  mature work permissionlessly; and dispatches finalized recommendations.
- `ThetaShieldController` implements Circle's V2 receiver interface and accepts
  recommendations only from the configured processor/domain.
- `ThetaShieldHook` records the same observation schema and attempts Circle
  dispatch after each nonzero swap. Transport failure emits an explicit event
  but does not revert the swap.

The Circle peer settings in the transport and controller are one-time sealed.
Replay, stale-window, cooldown, confidence, fee, risk, and pause behavior remain
enforced at the controller.

## Local evidence

The focused Circle tests prove:

- finalized-only message delivery;
- transmitter, source-domain, and sender authentication;
- versioned fixed-size encoding and decoding;
- observation and recommendation replay rejection;
- trusted-feed pulling with idempotent synchronization;
- bounded permissionless processing;
- hook fail-open behavior during a transport outage;
- independent directional recommendation output; and
- a real local Uniswap v4 PoolManager lifecycle from swap, through two mocked
  Circle attestations, to a later swap applying the updated dynamic fee.

The complete Solidity suite currently contains 97 tests: 95 pass and the two
legacy opt-in infrastructure fork tests skip without RPC configuration. The
standard test command exits successfully. Contract sizes remain below the
EIP-170 runtime limit; the Circle processor is the largest contract at roughly
21.4 kB with the release compiler settings.

## Intentionally deferred to Phase 8C

Legacy Reactive deployment validation, fork checks, documentation, submodules,
and environment names are still present as non-deployable historical material.
The old broadcast scripts were removed so they cannot be run accidentally.
Phase 8C replaces those gates with Circle-specific scripts and fork checks,
removes the unused dependencies, refreshes the dashboard and project narrative,
and runs the complete repository verification gate.

No live transaction and no hook submission occurred in Phase 8B.
