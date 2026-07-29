const CACHE_TTL_MS = 30 * 60 * 1000;

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

export function getKoreaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

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
    const dateKey = outing.startsAt.slice(0, 10);
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

export async function getOutingWeather(store, outing, fetchImpl = fetch) {
  const cached = store.getWeatherCache(outing.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const weather = await getForecastWeather(outing, fetchImpl);
  if (weather) {
    store.putWeatherCache(outing.id, weather);
    return weather;
  }
  return cached?.payload ?? null;
}
