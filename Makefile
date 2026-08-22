.PHONY: build clean fmt fmt-check test verify

build:
	forge build --sizes

clean:
	forge clean

fmt:
	forge fmt

fmt-check:
	forge fmt --check

test:
	forge test

verify: fmt-check build test
