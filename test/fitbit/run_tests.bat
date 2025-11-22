@echo off
REM test/fitbit/run_tests.bat
REM Fitbit単体テスト一括実行（Windows用）

echo ============================================================
echo Fitbit 単体テスト実行
echo ============================================================
echo.

cd /d "%~dp0..\..\"

echo [1/4] api.test.ts
deno test test/fitbit/api.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [2/4] auth.test.ts
deno test test/fitbit/auth.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [3/4] fetch_data.test.ts
deno test test/fitbit/fetch_data.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [4/4] write_db.test.ts
deno test test/fitbit/write_db.test.ts --allow-env --allow-read
if errorlevel 1 goto :error

echo.
echo ============================================================
echo 全テスト成功
echo ============================================================
exit /b 0

:error
echo.
echo ============================================================
echo テスト失敗
echo ============================================================
exit /b 1
