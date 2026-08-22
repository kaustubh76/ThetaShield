# Contributing to ThetaShield

ThetaShield is developed through gated phases. A phase may be committed to
`main` only after its documented verification gate passes.

## Development rules

1. Keep external and public Solidity APIs documented with NatSpec.
2. Use custom errors, explicit units, bounded loops, and fixed-point arithmetic
   with documented rounding.
3. Add unit tests and appropriate boundary, fuzz, invariant, integration, or
   cross-language tests for every behavior change.
4. Run `make verify` before committing.
5. Never commit private keys, API keys, funded mnemonics, or populated `.env`
   files.
6. Describe `notional x markout` only as an adverse-selection proxy or
   directional markout risk signal, never as exact LP loss or exact LVR.

## Phase commits

Each completed phase receives one clearly named commit on `main`. The evidence
for the phase gate is recorded in the phase handoff and summarized in the
commit message.
