PYTHON ?= python3

.PHONY: build clean experiment-check experiment-report fmt fmt-check golden-check lint python-check research-test test verify

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

test:
	forge test --force

verify: fmt-check lint build test python-check research-test golden-check experiment-check
