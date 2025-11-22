#!/bin/bash
# test/tanita/run_tests.sh
# Tanita関連のテストを実行

set -e

echo "=========================================="
echo "Tanita Tests"
echo "=========================================="
echo ""

cd "$(dirname "$0")/../.."

echo "[1/4] api.test.ts"
deno test test/tanita/api.test.ts --allow-env

echo ""
echo "[2/4] auth.test.ts"
deno test test/tanita/auth.test.ts --allow-env

echo ""
echo "[3/4] fetch_data.test.ts"
deno test test/tanita/fetch_data.test.ts --allow-env

echo ""
echo "[4/4] write_db.test.ts"
deno test test/tanita/write_db.test.ts --allow-env --allow-read

echo ""
echo "=========================================="
echo "All tests passed!"
echo "=========================================="
