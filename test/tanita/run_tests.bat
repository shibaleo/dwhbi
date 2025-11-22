@echo off
REM test\tanita\run_tests.bat
REM Tanita関連のテストを実行

echo ==========================================
echo Tanita Tests
echo ==========================================
echo.

cd /d "%~dp0..\.."

echo [1/4] api.test.ts
deno test test/tanita/api.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [2/4] auth.test.ts
deno test test/tanita/auth.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [3/4] fetch_data.test.ts
deno test test/tanita/fetch_data.test.ts --allow-env
if errorlevel 1 goto :error

echo.
echo [4/4] write_db.test.ts
deno test test/tanita/write_db.test.ts --allow-env --allow-read
if errorlevel 1 goto :error

echo.
echo ==========================================
echo All tests passed!
echo ==========================================
goto :end

:error
echo.
echo ==========================================
echo TEST FAILED
echo ==========================================
exit /b 1

:end
