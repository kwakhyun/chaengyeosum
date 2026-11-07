import assert from "node:assert/strict";
import test from "node:test";

import {
  addDaysToDateKey,
  getKoreaDateKey,
  getKoreaDayStartMs,
  isPastOuting,
  isStartsAtInAllowedRange,
  normalizeStartsAt,
} from "./kst-date.mjs";

test("한국 날짜 키는 UTC 날짜가 아닌 KST 날짜를 쓴다", () => {
  // UTC 15:30은 한국 시간으로 다음 날 00:30이에요.
  assert.equal(getKoreaDateKey(new Date("2026-08-01T15:30:00Z")), "2026-08-02");
  assert.equal(getKoreaDateKey("2026-08-01T15:30:00.000Z"), "2026-08-02");
  assert.equal(getKoreaDateKey("2026-08-02T00:30:00+09:00"), "2026-08-02");
  assert.equal(getKoreaDateKey("엉뚱한 값"), "");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(
    getKoreaDayStartMs(new Date("2026-08-01T15:30:00Z")),
    Date.parse("2026-08-02T00:00:00+09:00"),
  );
});

test("모임 시작 시각을 +09:00 형식으로 정규화하고 범위를 확인한다", () => {
  assert.equal(
    normalizeStartsAt("2026-08-01T15:30:45.123Z"),
    "2026-08-02T00:30:00+09:00",
  );
  assert.equal(
    normalizeStartsAt("2026-08-02T10:00"),
    "2026-08-02T10:00:00+09:00",
  );
  assert.equal(normalizeStartsAt("2026-08-02"), "2026-08-02T00:00:00+09:00");
  assert.equal(normalizeStartsAt("2026-02-30T10:00:00+09:00"), null);
  assert.equal(normalizeStartsAt("Aug 2 2026"), null);
  assert.equal(normalizeStartsAt(20260802), null);

  const now = Date.parse("2026-08-01T12:00:00+09:00");
  assert.equal(isStartsAtInAllowedRange("2026-08-01T00:10:00+09:00", now), true);
  assert.equal(isStartsAtInAllowedRange("2026-07-31T23:50:00+09:00", now), false);
  assert.equal(isStartsAtInAllowedRange("2027-08-01T10:00:00+09:00", now), true);
  assert.equal(isStartsAtInAllowedRange("2027-08-02T10:00:00+09:00", now), false);
  assert.equal(isPastOuting("2026-07-31T23:50:00+09:00", now), true);
  assert.equal(isPastOuting("2026-07-31T15:10:00Z", now), false);
});
