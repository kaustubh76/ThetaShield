# Research tooling needs CPython >= 3.10 (int.bit_count); pick the newest one
# available so a 3.9 system python3 does not fail the bundle gates.
PYTHON ?= $(shell for candidate in python3.13 python3.12 python3.11 python3.10 python3; do \
	  command -v $$candidate >/dev/null 2>&1 || continue; \
	  $$candidate -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1 && { echo $$candidate; exit 0; }; \
	done; echo python3)

.PHONY: boundary-fuzz-check build clean dashboard-bundle dashboard-bundle-check dashboard-check dashboard-deps dashboard-manifest dashboard-manifest-check dependency-check deployment-dry-run deployment-schema-check diagram diagram-check diagram-png experiment-check experiment-report fmt fmt-check fork-check gap-g1-check gap-g1-report gap-g2-check gap-g3-check gap-g4-check gap-g5-check gap-g6-check gap-g7-check gap-g10-check gas-check golden-check invariant-check lint phase5-check phase6-check phase6-report phase61-check phase61-report phase7-check phase9-check python-check reactive-legacy-check research-report research-test secret-check test verify

build:
	forge build --sizes

clean:
	forge clean

fmt:
	forge fmt

fmt-check:
	forge fmt --check

lint:
	forge lint --deny warnings

dependency-check:
	$(PYTHON) script/check_dependencies.py

secret-check:
	$(PYTHON) script/check_secrets.py

python-check:
	$(PYTHON) -m compileall -q research

research-test:
	$(PYTHON) -m unittest discover -s research/tests -p 'test_*.py'

golden-check:
	$(PYTHON) -m research.experiments.generate_golden_vectors --check

experiment-check:
	$(PYTHON) -m research.experiments.benign_noise --check

experiment-report:
	$(PYTHON) -m research.experiments.benign_noise

phase5-check:
	$(PYTHON) -m research.experiments.phase5_baselines --check

research-report:
	$(PYTHON) -m research.experiments.phase5_baselines

phase6-check:
	$(PYTHON) -m research.experiments.phase6_sensitivity --check

phase6-report:
	$(PYTHON) -m research.experiments.phase6_sensitivity

phase61-check:
	$(PYTHON) -m research.experiments.phase61_remediation --check

phase61-report:
	$(PYTHON) -m research.experiments.phase61_remediation

gap-g1-check:
	$(PYTHON) -m research.experiments.gap_g1_closed_loop --check

gap-g1-report:
	$(PYTHON) -m research.experiments.gap_g1_closed_loop

gap-g2-check:
	forge test --force --match-path 'test/math/*.t.sol' -vv
	forge test --force --match-path 'test/fuzz/*.t.sol' -vv
	forge test --force --match-path 'test/integration/GoldenVectors.t.sol' -vv
	forge test --force --match-path 'test/integration/ThetaShieldCircleProcessor.t.sol' -vv
	$(PYTHON) -m research.experiments.generate_golden_vectors --check

gap-g3-check:
	forge test --force --match-contract ConfigMirrorTest -vv
	forge test --force --match-contract ThetaShieldResearchProfileTest -vv
	forge build --sizes
	$(PYTHON) -m json.tool deployments/manifest.schema.json >/dev/null

gap-g4-check:
	forge test --force --match-contract ThetaShieldLensTest -vv
	forge build --sizes

gap-g5-check:
	forge test --force --match-contract PoolMedianReferenceSamplerTest -vv
	forge test --force --match-contract ConfigMirrorTest -vv
	forge test --force --match-contract ThetaShieldResearchProfileTest -vv
	forge build --sizes
	$(PYTHON) -m json.tool deployments/manifest.schema.json >/dev/null

reactive-legacy-check:
	forge test --force --match-contract ThetaShieldAutomationTest -vv
	forge test --force --match-contract ReactiveLegacyValidationTest -vv
	forge build --sizes
	$(MAKE) dependency-check

gap-g6-check: reactive-legacy-check

dashboard-bundle:
	$(PYTHON) -m research.experiments.export_dashboard_bundle

dashboard-bundle-check:
	$(PYTHON) -m research.experiments.export_dashboard_bundle --check

gap-g7-check: dashboard-bundle-check
	$(PYTHON) -m unittest research.tests.test_dashboard_bundle

gap-g10-check:
	forge test --force --match-contract ThetaShieldReferenceMarketTest -vv
	forge test --force --match-contract ThetaShieldLensTest -vv
	forge test --force --match-contract ThetaShieldAutomationTest -vv
	forge build --sizes

invariant-check:
	forge test --force --match-path 'test/invariant/*.t.sol' -vv

boundary-fuzz-check:
	forge test --force --match-path 'test/fuzz/*.t.sol' -vv

gas-check:
	forge test --force --match-path 'test/gas/*.t.sol' -vv

fork-check:
	forge test --force --match-path 'test/fork/*.t.sol' -vv

deployment-dry-run:
	forge test --force --match-contract DeploymentValidationTest -vv
	forge test --force --match-contract ThetaShieldCircleEndToEndTest -vv

deployment-schema-check:
	$(PYTHON) -m json.tool deployments/manifest.schema.json >/dev/null
	$(PYTHON) script/check_deployment_manifests.py

phase7-check: dependency-check secret-check boundary-fuzz-check invariant-check gas-check fork-check deployment-schema-check deployment-dry-run

diagram:
	$(PYTHON) script/gen_flow_diagram.py

diagram-check:
	$(PYTHON) script/gen_flow_diagram.py --check

# Not part of `verify`: it needs headless Chrome and the npm CDN, and a release
# gate should not depend on either. Run it after `make diagram` when the canvas
# changes, so the committed PNG cannot drift from the .excalidraw beside it.
diagram-png:
	node script/render_flow_png.mjs

dashboard-manifest:
	$(PYTHON) script/mirror_dashboard_manifest.py

dashboard-manifest-check:
	$(PYTHON) script/mirror_dashboard_manifest.py --check

dashboard-deps:
	npm --prefix dashboard ci --ignore-scripts --no-audit --no-fund

dashboard-check: dashboard-deps dashboard-manifest-check
	npm --prefix dashboard run verify

phase9-check: dashboard-check
	$(PYTHON) script/check_phase9.py

test:
	forge test --force

verify: fmt-check lint build test python-check research-test dependency-check secret-check deployment-schema-check diagram-check golden-check experiment-check phase5-check phase6-check phase61-check gap-g1-check reactive-legacy-check dashboard-bundle-check dashboard-manifest-check phase9-check
