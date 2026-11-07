import {
  addDaysToDateKey,
  getKoreaDateKey,
  getOutingDateKey,
} from "./kst-date.mjs";

export { getKoreaDateKey } from "./kst-date.mjs";

export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
// Open-Meteo 호출이 실패하면 폴링이 외부 API를 계속 두드리지 않도록
// 실패 결과도 10분 동안 기억해요.
export const WEATHER_FAILURE_TTL_MS = 10 * 60 * 1000;
// Open-Meteo 예보는 오늘 포함 16일(오늘 ~ 오늘+15일)까지 제공돼요.
export const WEATHER_FORECAST_MAX_DAYS_AHEAD = 15;

export const WEATHER_REGIONS = [
  {
    id: "seoul",
    name: "서울",
    spot: "한강",
    latitude: 37.5283,
    longitude: 126.9344,
  },
  {
    id: "busan",
    name: "부산",
    spot: "광안리",
    latitude: 35.1532,
    longitude: 129.1187,
  },
  {
    id: "gangneung",
    name: "강릉",
    spot: "경포",
    latitude: 37.7956,
    longitude: 128.907,
  },
  {
    id: "jeju",
    name: "제주",
    spot: "제주시",
    latitude: 33.4996,
    longitude: 126.5312,
  },
];

function uvLabel(value) {
  if (value >= 8) return "자외선 매우 높음";
  if (value >= 6) return "자외선 높음";
  if (value >= 3) return "자외선 보통";
  return "자외선 낮음";
}

function weatherLabel(code) {
  if (code >= 95) return "소나기";
  if (code >= 71) return "눈";
  if (code >= 51) return "비";
  if (code >= 45) return "안개";
  if (code >= 2) return "구름";
  return "맑음";
}

/** Open-Meteo 호출 자체가 실패했어요(시간 초과·HTTP 오류·잘못된 응답). */
export class WeatherFetchError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WeatherFetchError";
  }
}

/**
 * 모임 날짜의 예보를 받아요.
 * - 예보에 그 날짜가 없으면 null이에요(캐시해도 되는 결과).
 * - 호출이 실패하면 WeatherFetchError를 던져요(이전 예보를 지킬 수 있게).
 */
export async function getForecastWeather(outing, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: String(outing.latitude),
    longitude: String(outing.longitude),
    daily: [
      "weather_code",
      "temperature_2m_min",
      "temperature_2m_max",
      "precipitation_probability_max",
      "uv_index_max",
    ].join(","),
    timezone: "Asia/Seoul",
    forecast_days: "16",
  });

  let daily;
  try {
    const response = await fetchImpl(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`weather_${response.status}`);
    const data = await response.json();
    daily = data?.daily;
    if (!Array.isArray(daily?.time)) throw new Error("weather_malformed");
  } catch (error) {
    throw new WeatherFetchError(error?.message ?? "weather_fetch_failed");
  }

  const dateKey = getOutingDateKey(outing.startsAt);
  if (!dateKey) return null;
  const index = daily.time.indexOf(dateKey);
  if (index < 0) return null;

  try {
    return {
      date: dateKey,
      minTemperature: Math.round(daily.temperature_2m_min[index]),
      maxTemperature: Math.round(daily.temperature_2m_max[index]),
      precipitationProbability: Math.round(
        daily.precipitation_probability_max[index] ?? 0,
      ),
      uvIndex: Math.round(daily.uv_index_max[index] ?? 0),
      uvLabel: uvLabel(daily.uv_index_max[index] ?? 0),
      condition: weatherLabel(daily.weather_code[index] ?? 0),
      source: "Open-Meteo",
    };
  } catch {
    throw new WeatherFetchError("weather_malformed");
  }
}

/** 실패와 '예보에 날짜 없음'을 구분하지 않아도 되는 곳(미리보기 등)에서 써요. */
export function getForecastWeatherOrNull(outing, fetchImpl = fetch) {
  return getForecastWeather(outing, fetchImpl).catch(() => null);
}

export async function getRegionalWeatherHighlights(fetchImpl = fetch) {
  const date = getKoreaDateKey();
  const regions = await Promise.all(
    WEATHER_REGIONS.map(async (region) => ({
      ...region,
      weather: await getForecastWeatherOrNull(
        {
          id: `weather-${region.id}-${date}`,
          startsAt: `${date}T12:00:00+09:00`,
          latitude: region.latitude,
          longitude: region.longitude,
        },
        fetchImpl,
      ),
    })),
  );
  return {
    regions: regions.filter((region) => region.weather),
    meta: { generatedAt: Date.now(), date },
  };
}

/**
 * 모임 날짜가 예보 범위 안인지 판단해요.
 * "past" | "out_of_range" | "ok" (날짜를 읽을 수 없으면 "unavailable")
 */
export function getWeatherWindowStatus(startsAt, now = Date.now()) {
  const dateKey = getOutingDateKey(startsAt);
  if (!dateKey) return "unavailable";
  const today = getKoreaDateKey(now);
  if (dateKey < today) return "past";
  if (dateKey > addDaysToDateKey(today, WEATHER_FORECAST_MAX_DAYS_AHEAD)) {
    return "out_of_range";
  }
  return "ok";
}

export function getWeatherCacheTtl(payload) {
  return payload ? WEATHER_CACHE_TTL_MS : WEATHER_FAILURE_TTL_MS;
}

export function isWeatherCacheFresh(payload, fetchedAt, now = Date.now()) {
  return now - Number(fetchedAt) < getWeatherCacheTtl(payload);
}

/**
 * ETag의 weatherStamp를 DB 조회 없이 계산해요.
 * 새로 예보를 받아야 해서 값을 알 수 없으면 null이에요.
 */
export function getCachedWeatherStamp({
  weatherStatus,
  cachePayload,
  cacheFetchedAt,
  now = Date.now(),
  enabled = true,
  allowStale = false,
}) {
  if (weatherStatus !== "ok" || !enabled) return 0;
  if (cacheFetchedAt == null) return null;
  if (!allowStale && !isWeatherCacheFresh(cachePayload, cacheFetchedAt, now)) {
    return null;
  }
  return Number(cacheFetchedAt);
}

/** 갱신에 실패해 이전 예보를 다시 쓸 때의 fetchedAt이에요(10분 뒤 재시도). */
export function getWeatherRetryFetchedAt(now = Date.now()) {
  return now - (WEATHER_CACHE_TTL_MS - WEATHER_FAILURE_TTL_MS);
}

/**
 * 모임 날씨를 캐시와 함께 계산해요.
 * - 예보 범위 밖이면 Open-Meteo를 부르지 않아요.
 * - 갱신이 실패하면 이전 예보가 있을 때는 그대로 두고 10분 뒤 다시 시도해요.
 *   이전 예보가 없을 때만 null(=unavailable)을 10분 캐시해요.
 * - scheduleRefresh가 있으면 오래된 캐시를 먼저 돌려주고 뒤에서 갱신해요.
 * - force면 캐시가 신선해도 바로 갱신해요(이전 예보는 실패 대비로 읽어요).
 * - writeCache는 모임의 날짜·장소가 그대로일 때만 써야 해요
 *   (SQL.putWeather 참고).
 */
export async function resolveOutingWeather({
  outing,
  readCache,
  writeCache,
  fetchImpl = fetch,
  now = Date.now(),
  enabled = true,
  scheduleRefresh = null,
  force = false,
}) {
  const windowStatus = getWeatherWindowStatus(outing.startsAt, now);
  if (windowStatus !== "ok") {
    return { weather: null, weatherStatus: windowStatus, weatherStamp: 0 };
  }
  if (!enabled) {
    return { weather: null, weatherStatus: "unavailable", weatherStamp: 0 };
  }

  const cached = await readCache();
  const previous = cached?.payload ?? null;

  const refresh = async () => {
    let weather;
    try {
      weather = await getForecastWeather(outing, fetchImpl);
    } catch (error) {
      if (!(error instanceof WeatherFetchError)) throw error;
      if (previous) {
        const retryFetchedAt = getWeatherRetryFetchedAt(now);
        await writeCache(previous, retryFetchedAt);
        return {
          weather: previous,
          weatherStatus: "ok",
          weatherStamp: retryFetchedAt,
        };
      }
      weather = null;
    }
    await writeCache(weather ?? null, now);
    return {
      weather: weather ?? null,
      weatherStatus: weather ? "ok" : "unavailable",
      weatherStamp: now,
    };
  };

  if (cached && !force) {
    const fromCache = {
      weather: previous,
      weatherStatus: previous ? "ok" : "unavailable",
      weatherStamp: Number(cached.fetchedAt),
    };
    if (isWeatherCacheFresh(cached.payload, cached.fetchedAt, now)) {
      return fromCache;
    }
    if (scheduleRefresh) {
      scheduleRefresh(refresh);
      return fromCache;
    }
  }
  return refresh();
}
