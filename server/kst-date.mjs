// 한국 시간(KST, UTC+9, 서머타임 없음) 기준 날짜 계산을 한곳에 모아요.
// Node API와 Cloudflare Worker가 같은 규칙으로 날짜 키·지난 모임·날씨
// 범위를 판단하도록 이 모듈만 사용해요.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseDateInput(value);
    if (parsed != null) return parsed;
    const fallback = Date.parse(value);
    return Number.isFinite(fallback) ? fallback : Number.NaN;
  }
  return Number.NaN;
}

/**
 * ISO 8601 형태의 날짜 문자열만 받아 epoch ms로 바꿔요.
 * 시간대가 없으면 한국 시간으로, 날짜만 있으면 한국 자정으로 봐요.
 */
export function parseDateInput(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  let offsetMinutes = 9 * 60;
  if (zone) {
    if (zone.toUpperCase() === "Z") {
      offsetMinutes = 0;
    } else {
      const sign = zone[0] === "-" ? -1 : 1;
      const digits = zone.slice(1).replace(":", "");
      const offsetHours = Number(digits.slice(0, 2));
      const offsetRest = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
      if (offsetHours > 14 || offsetRest > 59) return null;
      offsetMinutes = sign * (offsetHours * 60 + offsetRest);
    }
  }
  return (
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMinutes * 60 * 1000
  );
}

/** 한국 날짜 키(YYYY-MM-DD). 잘못된 값이면 빈 문자열이에요. */
export function getKoreaDateKey(value = Date.now()) {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH:mm:ss+09:00` 형태의 한국 시간 ISO 문자열이에요. */
export function toKstIsoString(value, { truncateSeconds = false } = {}) {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + KST_OFFSET_MS).toISOString();
  const seconds = truncateSeconds ? "00" : shifted.slice(17, 19);
  return `${shifted.slice(0, 16)}:${seconds}+09:00`;
}

/** 모임 시작 시각을 `YYYY-MM-DDTHH:mm:00+09:00`로 정규화해요. */
export function normalizeStartsAt(value) {
  const ms = parseDateInput(value);
  return ms == null ? null : toKstIsoString(ms, { truncateSeconds: true });
}

/** 저장된 startsAt(형식이 달라도)의 한국 날짜 키예요. */
export function getOutingDateKey(startsAt) {
  const key = getKoreaDateKey(startsAt);
  return key || null;
}

export function addDaysToDateKey(dateKey, days) {
  const base = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(base)) return "";
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** 한국 시간 자정의 epoch ms예요. 일 단위 사용량 집계 창으로 써요. */
export function getKoreaDayStartMs(value = Date.now()) {
  return Date.parse(`${getKoreaDateKey(value)}T00:00:00+09:00`);
}

export function isPastOuting(startsAt, now = Date.now()) {
  const dateKey = getOutingDateKey(startsAt);
  return dateKey != null && dateKey < getKoreaDateKey(now);
}

export function isOutingToday(startsAt, now = Date.now()) {
  return getOutingDateKey(startsAt) === getKoreaDateKey(now);
}

/** 오늘(KST)부터 maxDaysAhead일 뒤까지만 모임 날짜로 받아요. */
export function isStartsAtInAllowedRange(
  startsAt,
  now = Date.now(),
  maxDaysAhead = 365,
) {
  const dateKey = getOutingDateKey(startsAt);
  if (!dateKey) return false;
  const today = getKoreaDateKey(now);
  return dateKey >= today && dateKey <= addDaysToDateKey(today, maxDaysAhead);
}
