// test/fitbit/write_db.test.ts
// write_db.ts の変換関数に対する単体テスト

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  toDbSleep,
  toDbActivityDaily,
  toDbHeartRateDaily,
  toDbHrvDaily,
  toDbSpo2Daily,
  toDbBreathingRateDaily,
  toDbCardioScoreDaily,
  toDbTemperatureSkinDaily,
} from "../../src/services/fitbit/write_db.ts";

import type {
  SleepLog,
  ActivitySummary,
  AzmDay,
  HeartRateDay,
  HrvDay,
  Spo2ApiResponse,
  BreathingRateDay,
  CardioScoreDay,
  TemperatureSkinDay,
} from "../../src/services/fitbit/types.ts";

// ============================================================
// toDbSleep
// ============================================================

Deno.test("toDbSleep: 基本的な変換", () => {
  const input: SleepLog[] = [{
    logId: 12345678901,
    dateOfSleep: "2025-01-15",
    startTime: "2025-01-14T23:30:00.000",
    endTime: "2025-01-15T07:00:00.000",
    duration: 27000000, // 7.5時間（ミリ秒）
    efficiency: 92,
    isMainSleep: true,
    minutesAsleep: 420,
    minutesAwake: 30,
    timeInBed: 450,
    type: "stages",
    levels: {
      data: [{ dateTime: "2025-01-14T23:30:00.000", level: "light", seconds: 600 }],
      summary: { deep: { count: 3, minutes: 90 }, light: { count: 20, minutes: 240 }, rem: { count: 5, minutes: 80 }, wake: { count: 10, minutes: 30 } },
    },
  }];

  const result = toDbSleep(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].log_id, 12345678901);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].start_time, "2025-01-14T23:30:00.000");
  assertEquals(result[0].end_time, "2025-01-15T07:00:00.000");
  assertEquals(result[0].duration_ms, 27000000);
  assertEquals(result[0].efficiency, 92);
  assertEquals(result[0].is_main_sleep, true);
  assertEquals(result[0].minutes_asleep, 420);
  assertEquals(result[0].minutes_awake, 30);
  assertEquals(result[0].time_in_bed, 450);
  assertEquals(result[0].sleep_type, "stages");
  assertExists(result[0].levels);
});

Deno.test("toDbSleep: 複数レコード", () => {
  const input: SleepLog[] = [
    {
      logId: 1, dateOfSleep: "2025-01-15", startTime: "2025-01-14T23:00:00.000",
      endTime: "2025-01-15T07:00:00.000", duration: 28800000, efficiency: 90,
      isMainSleep: true, minutesAsleep: 400, minutesAwake: 40, timeInBed: 480, type: "stages",
    },
    {
      logId: 2, dateOfSleep: "2025-01-15", startTime: "2025-01-15T14:00:00.000",
      endTime: "2025-01-15T14:30:00.000", duration: 1800000, efficiency: 95,
      isMainSleep: false, minutesAsleep: 25, minutesAwake: 5, timeInBed: 30, type: "classic",
    },
  ];

  const result = toDbSleep(input);

  assertEquals(result.length, 2);
  assertEquals(result[0].is_main_sleep, true);
  assertEquals(result[1].is_main_sleep, false);
});

Deno.test("toDbSleep: 空配列", () => {
  const result = toDbSleep([]);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbActivityDaily
// ============================================================

Deno.test("toDbActivityDaily: 基本的な変換", () => {
  const activityMap = new Map<string, ActivitySummary>();
  activityMap.set("2025-01-15", {
    steps: 8500,
    floors: 10,
    caloriesOut: 2200,
    caloriesBMR: 1600,
    activityCalories: 600,
    distances: [{ activity: "total", distance: 6.5 }],
    sedentaryMinutes: 720,
    lightlyActiveMinutes: 180,
    fairlyActiveMinutes: 45,
    veryActiveMinutes: 30,
  });

  const azmData: AzmDay[] = [{
    dateTime: "2025-01-15",
    value: {
      activeZoneMinutes: 75,
      fatBurnActiveZoneMinutes: 45,
      cardioActiveZoneMinutes: 25,
      peakActiveZoneMinutes: 5,
    },
  }];

  const result = toDbActivityDaily(activityMap, azmData);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].steps, 8500);
  assertEquals(result[0].floors, 10);
  assertEquals(result[0].distance_km, 6.5);
  assertEquals(result[0].calories_total, 2200);
  assertEquals(result[0].calories_bmr, 1600);
  assertEquals(result[0].calories_activity, 600);
  assertEquals(result[0].sedentary_minutes, 720);
  assertEquals(result[0].lightly_active_minutes, 180);
  assertEquals(result[0].fairly_active_minutes, 45);
  assertEquals(result[0].very_active_minutes, 30);
  assertExists(result[0].active_zone_minutes);
});

Deno.test("toDbActivityDaily: AZMデータなし", () => {
  const activityMap = new Map<string, ActivitySummary>();
  activityMap.set("2025-01-15", {
    steps: 5000, floors: 5, caloriesOut: 1800, caloriesBMR: 1500,
    activityCalories: 300, distances: [], sedentaryMinutes: 800,
    lightlyActiveMinutes: 100, fairlyActiveMinutes: 20, veryActiveMinutes: 10,
  });

  const result = toDbActivityDaily(activityMap, []);

  assertEquals(result.length, 1);
  assertEquals(result[0].active_zone_minutes, undefined);
});

Deno.test("toDbActivityDaily: 空Map", () => {
  const result = toDbActivityDaily(new Map(), []);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbHeartRateDaily
// ============================================================

Deno.test("toDbHeartRateDaily: 基本的な変換", () => {
  const input: HeartRateDay[] = [{
    dateTime: "2025-01-15",
    value: {
      restingHeartRate: 58,
      heartRateZones: [
        { name: "Out of Range", min: 30, max: 96, minutes: 1200, caloriesOut: 1000 },
        { name: "Fat Burn", min: 96, max: 134, minutes: 60, caloriesOut: 300 },
        { name: "Cardio", min: 134, max: 167, minutes: 30, caloriesOut: 200 },
        { name: "Peak", min: 167, max: 220, minutes: 5, caloriesOut: 50 },
      ],
    },
  }];

  const result = toDbHeartRateDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].resting_heart_rate, 58);
  assertExists(result[0].heart_rate_zones);
});

Deno.test("toDbHeartRateDaily: restingHeartRateなし", () => {
  const input: HeartRateDay[] = [{
    dateTime: "2025-01-15",
    value: {
      heartRateZones: [],
    },
  }];

  const result = toDbHeartRateDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].resting_heart_rate, undefined);
});

Deno.test("toDbHeartRateDaily: 空配列", () => {
  const result = toDbHeartRateDaily([]);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbHrvDaily
// ============================================================

Deno.test("toDbHrvDaily: 基本的な変換", () => {
  const input: HrvDay[] = [{
    dateTime: "2025-01-15",
    value: {
      dailyRmssd: 42.5,
      deepRmssd: 48.2,
    },
    minutes: [
      { minute: "2025-01-15T02:00:00", value: { rmssd: 45.0, coverage: 0.95, hf: 1200, lf: 800 } },
    ],
  }];

  const result = toDbHrvDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].daily_rmssd, 42.5);
  assertEquals(result[0].deep_rmssd, 48.2);
  assertExists(result[0].intraday);
});

Deno.test("toDbHrvDaily: minutesなし", () => {
  const input: HrvDay[] = [{
    dateTime: "2025-01-15",
    value: { dailyRmssd: 40.0, deepRmssd: 45.0 },
  }];

  const result = toDbHrvDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].intraday, undefined);
});

Deno.test("toDbHrvDaily: 空配列", () => {
  const result = toDbHrvDaily([]);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbSpo2Daily
// ============================================================

Deno.test("toDbSpo2Daily: 基本的な変換", () => {
  const spo2Map = new Map<string, Spo2ApiResponse>();
  spo2Map.set("2025-01-15", {
    dateTime: "2025-01-15",
    value: { avg: 96.5, min: 94.0, max: 98.0 },
  });

  const result = toDbSpo2Daily(spo2Map);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].avg_spo2, 96.5);
  assertEquals(result[0].min_spo2, 94.0);
  assertEquals(result[0].max_spo2, 98.0);
});

Deno.test("toDbSpo2Daily: valueなしはスキップ", () => {
  const spo2Map = new Map<string, Spo2ApiResponse>();
  spo2Map.set("2025-01-15", { dateTime: "2025-01-15" }); // value がない

  const result = toDbSpo2Daily(spo2Map);

  assertEquals(result.length, 0);
});

Deno.test("toDbSpo2Daily: 空Map", () => {
  const result = toDbSpo2Daily(new Map());
  assertEquals(result.length, 0);
});

// ============================================================
// toDbBreathingRateDaily
// ============================================================

Deno.test("toDbBreathingRateDaily: 基本的な変換", () => {
  const input: BreathingRateDay[] = [{
    dateTime: "2025-01-15",
    value: { breathingRate: 14.5 },
  }];

  const result = toDbBreathingRateDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].breathing_rate, 14.5);
});

Deno.test("toDbBreathingRateDaily: 複数日", () => {
  const input: BreathingRateDay[] = [
    { dateTime: "2025-01-15", value: { breathingRate: 14.5 } },
    { dateTime: "2025-01-16", value: { breathingRate: 15.0 } },
  ];

  const result = toDbBreathingRateDaily(input);

  assertEquals(result.length, 2);
});

Deno.test("toDbBreathingRateDaily: 空配列", () => {
  const result = toDbBreathingRateDaily([]);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbCardioScoreDaily
// ============================================================

Deno.test("toDbCardioScoreDaily: 範囲値（30-35形式）", () => {
  const input: CardioScoreDay[] = [{
    dateTime: "2025-01-15",
    value: { vo2Max: "30-35" },
  }];

  const result = toDbCardioScoreDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].vo2_max, 32.5); // 中央値
  assertEquals(result[0].vo2_max_range_low, 30);
  assertEquals(result[0].vo2_max_range_high, 35);
});

Deno.test("toDbCardioScoreDaily: 単一値", () => {
  const input: CardioScoreDay[] = [{
    dateTime: "2025-01-15",
    value: { vo2Max: "42" },
  }];

  const result = toDbCardioScoreDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].vo2_max, 42);
  assertEquals(result[0].vo2_max_range_low, undefined);
  assertEquals(result[0].vo2_max_range_high, undefined);
});

Deno.test("toDbCardioScoreDaily: 空配列", () => {
  const result = toDbCardioScoreDaily([]);
  assertEquals(result.length, 0);
});

// ============================================================
// toDbTemperatureSkinDaily
// ============================================================

Deno.test("toDbTemperatureSkinDaily: 基本的な変換", () => {
  const input: TemperatureSkinDay[] = [{
    dateTime: "2025-01-15",
    value: { nightlyRelative: 0.5 },
    logType: "skin",
  }];

  const result = toDbTemperatureSkinDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].date, "2025-01-15");
  assertEquals(result[0].nightly_relative, 0.5);
  assertEquals(result[0].log_type, "skin");
});

Deno.test("toDbTemperatureSkinDaily: 負の相対値", () => {
  const input: TemperatureSkinDay[] = [{
    dateTime: "2025-01-15",
    value: { nightlyRelative: -0.3 },
  }];

  const result = toDbTemperatureSkinDaily(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].nightly_relative, -0.3);
});

Deno.test("toDbTemperatureSkinDaily: 空配列", () => {
  const result = toDbTemperatureSkinDaily([]);
  assertEquals(result.length, 0);
});
