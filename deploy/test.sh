#!/usr/bin/env bash
# Run by .github/workflows/pages.yml before deploy/build.sh: if it fails, nothing is published.
# Node tests of the rules and the observatory maths (no dependencies). The GPU tests in web/tests/
# need a browser with WebGPU and are run by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
