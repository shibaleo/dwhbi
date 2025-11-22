#!/bin/bash
# test/fitbit/run_tests.sh
# Fitbit単体テスト一括実行（Unix用）

set -e

echo "============================================================"
echo "Fitbit 単体テスト実行"
echo "============================================================"
echo

cd "$(dirname "$0")/../.."

echo "[1/4] api.test.ts"
deno test test/fitbit/api.test.ts --allow-env

echo
echo "[2/4] auth.test.ts"
deno test test/fitbit/auth.test.ts --allow-env

echo
echo "[3/4] fetch_data.test.ts"
deno test test/fitbit/fetch_data.test.ts --allow-env

echo
echo "[4/4] write_db.test.ts"
deno test test/fitbit/write_db.test.ts --allow-env --allow-read

echo
echo "============================================================"
echo "全テスト成功"
echo "============================================================"
