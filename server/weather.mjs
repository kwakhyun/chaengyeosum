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

  try {
    const response = await fetchImpl(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`weather_${response.status}`);
    const data = await response.json();
    const dateKey = getOutingDateKey(outing.startsAt);
    if (!dateKey) return null;
    const index = data.daily?.time?.indexOf(dateKey) ?? -1;
    if (index < 0) return null;

    return {
      date: dateKey,
      minTemperature: Math.round(data.daily.temperature_2m_min[index]),
      maxTemperature: Math.round(data.daily.temperature_2m_max[index]),
      precipitationProbability: Math.round(
        data.daily.precipitation_probability_max[index] ?? 0,
      ),
      uvIndex: Math.round(data.daily.uv_index_max[index] ?? 0),
      uvLabel: uvLabel(data.daily.uv_index_max[index] ?? 0),
      condition: weatherLabel(data.daily.weather_code[index] ?? 0),
      source: "Open-Meteo",
    };
  } catch {
    return null;
  }
}

export async function getRegionalWeatherHighlights(fetchImpl = fetch) {
  const date = getKoreaDateKey();
  const regions = await Promise.all(
    WEATHER_REGIONS.map(async (region) => ({
      ...region,
      weather: await getForecastWeather(
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

/**
 * 모임 날씨를 캐시와 함께 계산해요.
 * - 예보 범위 밖이면 Open-Meteo를 부르지 않아요.
 * - 실패하면 null(=unavailable)을 10분 캐시해요.
 * - scheduleRefresh가 있으면 오래된 캐시를 먼저 돌려주고 뒤에서 갱신해요.
 */
export async function resolveOutingWeather({
  outing,
  readCache,
  writeCache,
  fetchImpl = fetch,
  now = Date.now(),
  enabled = true,
  scheduleRefresh = null,
}) {
  const windowStatus = getWeatherWindowStatus(outing.startsAt, now);
  if (windowStatus !== "ok") {
    return { weather: null, weatherStatus: windowStatus, weatherStamp: 0 };
  }
  if (!enabled) {
    return { weather: null, weatherStatus: "unavailable", weatherStamp: 0 };
  }

  const refresh = async () => {
    const weather = await getForecastWeather(outing, fetchImpl);
    const fetchedAt = now;
    await writeCache(weather ?? null, fetchedAt);
    return {
      weather: weather ?? null,
      weatherStatus: weather ? "ok" : "unavailable",
      weatherStamp: fetchedAt,
    };
  };

  const cached = await readCache();
  if (cached) {
    const fromCache = {
      weather: cached.payload ?? null,
      weatherStatus: cached.payload ? "ok" : "unavailable",
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
