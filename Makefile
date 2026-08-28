PYTHON ?= python3

.PHONY: boundary-fuzz-check build clean dashboard-check dashboard-deps dependency-check deployment-dry-run deployment-schema-check experiment-check experiment-report fmt fmt-check fork-check gap-g1-check gap-g1-report gap-g2-check gas-check golden-check invariant-check lint phase5-check phase6-check phase6-report phase61-check phase61-report phase7-check phase9-check python-check research-report research-test secret-check test verify

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

phase7-check: dependency-check secret-check boundary-fuzz-check invariant-check gas-check fork-check deployment-schema-check deployment-dry-run

dashboard-deps:
	npm --prefix dashboard ci --ignore-scripts --no-audit --no-fund

dashboard-check: dashboard-deps
	npm --prefix dashboard run verify

phase9-check: dashboard-check
	$(PYTHON) script/check_phase9.py

test:
	forge test --force

verify: fmt-check lint build test python-check research-test dependency-check secret-check deployment-schema-check golden-check experiment-check phase5-check phase6-check phase61-check gap-g1-check phase9-check
