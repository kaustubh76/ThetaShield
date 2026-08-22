PYTHON ?= python3

.PHONY: build clean experiment-check experiment-report fmt fmt-check golden-check lint phase5-check phase6-check phase6-report phase61-check phase61-report python-check research-report research-test test verify

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

test:
	forge test --force

verify: fmt-check lint build test python-check research-test golden-check experiment-check phase5-check phase6-check phase61-check
