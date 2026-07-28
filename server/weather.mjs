const CACHE_TTL_MS = 30 * 60 * 1000;

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
