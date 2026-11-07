// 모든 날짜 계산은 기기 시간대와 상관없이 한국 시간(KST) 기준으로 해요.
const KOREA_TIME_ZONE = "Asia/Seoul";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KOREA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: KOREA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 한국 시간 기준 YYYY-MM-DD */
export function koreaDateKey(value: Date | string = new Date()) {
  const date = typeof value === "string" ? parseKoreaDateTime(value) : value;
  if (Number.isNaN(date.valueOf())) return "";
  return dateKeyFormatter.format(date);
}

/** 오프셋 없는 "YYYY-MM-DD HH:mm" 값은 한국 시간으로 해석해요. */
export function parseKoreaDateTime(value: string) {
  const naive = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
  );
  if (naive) {
    return new Date(
      `${naive[1]}T${naive[2]}:${naive[3]}:${naive[4] ?? "00"}+09:00`,
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00+09:00`);
  }
  return new Date(value);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateKeyToUtc(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function todayDateKey() {
  return koreaDateKey(new Date());
}

/** 오늘(KST)부터 모임 날짜까지 남은 일수. 지난 모임은 음수예요. */
export function daysUntil(startsAt: string) {
  const eventKey = koreaDateKey(startsAt);
  if (!eventKey) return 0;
  return Math.round(
    (dateKeyToUtc(eventKey) - dateKeyToUtc(todayDateKey())) / 86_400_000,
  );
}

export function formatDateKey(dateKey: string, withWeekday = true) {
  const [, month, day] = dateKey.split("-").map(Number);
  if (!month || !day) return "";
  const weekday = WEEKDAYS[new Date(dateKeyToUtc(dateKey)).getUTCDay()];
  return withWeekday ? `${month}월 ${day}일 (${weekday})` : `${month}월 ${day}일`;
}

export function relativeDayLabel(startsAt: string) {
  const diff = daysUntil(startsAt);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff > 1) return `D-${diff}`;
  return "지난 모임";
}

/** "내일 · 11월 9일" */
export function formatOutingDate(startsAt: string) {
  const key = koreaDateKey(startsAt);
  return `${relativeDayLabel(startsAt)} · ${formatDateKey(key, false)}`;
}

/** 관측·예측 시각을 한국 시간 HH:mm 으로 보여줘요. */
export function formatKoreaTime(value: string | null | undefined) {
  if (!value) return "";
  const date = parseKoreaDateTime(value);
  if (Number.isNaN(date.valueOf())) return "";
  return timeFormatter.format(date);
}

export function isSummerSeason(date = new Date()) {
  const month = Number(koreaDateKey(date).slice(5, 7));
  return month >= 6 && month <= 8;
}

/** 활동 소식에 쓰는 "방금 · 5분 전 · 3시간 전 · 2일 전" 표시 */
export function relativeTimeLabel(value: string, now = Date.now()) {
  const time = parseKoreaDateTime(value).valueOf();
  if (Number.isNaN(time)) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return formatDateKey(koreaDateKey(new Date(time)), false);
}
