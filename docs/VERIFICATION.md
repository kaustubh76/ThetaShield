# Verification

## Standard local gate

Run the complete local gate from the repository root:

```sh
make verify
```

This checks Solidity formatting, compiles all contracts with the pinned compiler
configuration, and runs the Foundry test suite.

## Dependency integrity

Dependencies are Git submodules pinned by the parent repository. Initialize them
after cloning:

```sh
git submodule update --init --recursive
git submodule status --recursive
```

A status line beginning with a space means the dependency is checked out at the
recorded commit.

## Phase 0 clean-clone gate

1. Clone the private repository into a new temporary directory with submodules.
2. Run `make verify` in the clone.
3. Confirm the default branch is `main` and the GitHub visibility is `PRIVATE`.
4. Confirm `git status --short` is empty in the source repository.

Later phases will add their exact reproducibility commands and expected outputs
to this document.
