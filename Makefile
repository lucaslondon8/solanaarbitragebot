# ==============================================================================
# Solana Arbitrage Bot Makefile (Final Version)
# ==============================================================================

# Default shell
SHELL := /bin/bash

.PHONY: help bootstrap build build-program build-sdk localnet-test clean

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  bootstrap         Install all Rust and Node.js dependencies"
	@echo "  build             Build the Anchor program and the TypeScript SDK"
	@echo "  build-program     Build just the Anchor program"
	@echo "  build-sdk         Generate the TypeScript SDK from the program IDL"
	@echo "  localnet-test     Run the full test suite against a local validator"
	@echo "  clean             Remove build artifacts"

bootstrap:
	@echo "--- 📦 Bootstrapping project dependencies... ---"
	@yarn install
	@echo "✅ Node.js dependencies installed."

# -- Building ------------------------------------------------------------------

build: build-program build-sdk
	@echo "--- 🎉 Project built successfully! ---"

build-program:
	@echo "--- 🦀 Building Anchor program... ---"
	@(cd program && anchor build)
	@echo "✅ Anchor program built."

# -- THIS SECTION IS UPDATED --
build-sdk:
	@echo "--- 📜 Generating TypeScript SDK... ---"
	@mkdir -p sdk/
	# Corrected flag from --out-file to --out
	@(cd program && anchor idl build --out ../sdk/idl.json)
	@echo "✅ SDK generated at /sdk/idl.json"

# -- Testing & Running ---------------------------------------------------------

localnet-test: build
	@echo "--- 🧪 Starting localnet validator and running tests... ---"
	@(cd program && anchor test)
	@echo "✅ Tests complete."

# -- Cleanup -------------------------------------------------------------------

clean:
	@echo "--- 🧹 Cleaning up build artifacts... ---"
	@(cd program && anchor clean)
	@rm -rf node_modules bot/node_modules sdk/node_modules
	@echo "✅ Cleanup complete."
