/**
 * 全サービス単体テストランナー
 *
 * 使用法:
 *   deno run --allow-run --allow-read test/run_tests.ts
 *   deno run --allow-run --allow-read test/run_tests.ts fitbit
 *   deno run --allow-run --allow-read test/run_tests.ts toggl tanita
 *
 * または deno task を使用（推奨）:
 *   deno task test           # 全サービス
 *   deno task test:fitbit    # Fitbitのみ
 *   deno task test:tanita    # Tanitaのみ
 *   deno task test:toggl     # Togglのみ
 *   deno task test:zaim      # Zaimのみ
 *   deno task test:gcalendar # Google Calendarのみ
 *
 * または直接:
 *   deno test test/ --allow-env --allow-read
 */

// =============================================================================
// Types
// =============================================================================

interface TestResult {
  service: string;
  success: boolean;
  output: string;
  elapsedMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const SERVICES = ["fitbit", "tanita", "toggl", "zaim", "gcalendar"] as const;
type Service = (typeof SERVICES)[number];

// =============================================================================
// Utilities
// =============================================================================

function log(level: string, message: string): void {
  const timestamp = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`[${level.padEnd(7)}] ${timestamp} ${message}`);
}

async function runServiceTests(service: string): Promise<TestResult> {
  const startTime = Date.now();

  log("INFO", `Testing ${service}...`);

  const command = new Deno.Command("deno", {
    args: ["test", `test/${service}/`, "--allow-env", "--allow-read"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  const output = new TextDecoder().decode(stdout) +
    new TextDecoder().decode(stderr);
  const elapsedMs = Date.now() - startTime;
  const success = code === 0;

  if (success) {
    log("SUCCESS", `${service} passed (${elapsedMs}ms)`);
  } else {
    log("ERROR", `${service} failed (${elapsedMs}ms)`);
    console.log(output);
  }

  return { service, success, output, elapsedMs };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = Deno.args;

  // 対象サービスを決定
  let targetServices: string[];

  if (args.length === 0) {
    targetServices = [...SERVICES];
  } else if (args.includes("--help") || args.includes("-h")) {
    console.log(`
単体テストランナー

使用法:
  deno run --allow-run --allow-read test/run_tests.ts [services...]

引数:
  services    テスト対象サービス（省略時は全サービス）
              利用可能: ${SERVICES.join(", ")}

例:
  # 全サービスをテスト
  deno run --allow-run --allow-read test/run_tests.ts

  # 特定サービスのみテスト
  deno run --allow-run --allow-read test/run_tests.ts fitbit toggl

推奨: deno task を使用
  deno task test           # 全サービス
  deno task test:fitbit    # Fitbitのみ
  deno task test:tanita    # Tanitaのみ
  deno task test:toggl     # Togglのみ
  deno task test:zaim      # Zaimのみ
  deno task test:gcalendar # Google Calendarのみ
  deno task test:watch     # ファイル変更時に自動再実行
  deno task test:coverage  # カバレッジ付き
`);
    Deno.exit(0);
  } else {
    targetServices = args.filter((arg) =>
      SERVICES.includes(arg as Service)
    );

    if (targetServices.length === 0) {
      console.error(
        `無効なサービス名です。利用可能: ${SERVICES.join(", ")}`,
      );
      Deno.exit(1);
    }
  }

  console.log("=".repeat(60));
  console.log("  単体テスト実行");
  console.log("=".repeat(60));
  console.log(`対象: ${targetServices.join(", ")}\n`);

  // テスト実行
  const results: TestResult[] = [];

  for (const service of targetServices) {
    const result = await runServiceTests(service);
    results.push(result);
    console.log("");
  }

  // サマリー
  console.log("=".repeat(60));
  console.log("  結果サマリー");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);

  for (const r of results) {
    const status = r.success ? "✓" : "✗";
    console.log(
      `  ${status} ${r.service.padEnd(12)} ${r.elapsedMs.toString().padStart(5)}ms`,
    );
  }

  console.log("-".repeat(60));
  console.log(
    `  合計: ${passed} passed, ${failed} failed (${totalMs}ms)`,
  );
  console.log("=".repeat(60));

  Deno.exit(failed > 0 ? 1 : 0);
}

if (import.meta.main) {
  main();
}
