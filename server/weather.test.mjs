import assert from "node:assert/strict";
import test from "node:test";

import { addDaysToDateKey, getKoreaDateKey } from "./kst-date.mjs";
import {
  getForecastWeather,
  getForecastWeatherOrNull,
  getWeatherRetryFetchedAt,
  resolveOutingWeather,
  WEATHER_CACHE_TTL_MS,
  WEATHER_FAILURE_TTL_MS,
  WeatherFetchError,
} from "./weather.mjs";

const NOW = Date.now();
const today = getKoreaDateKey(NOW);
const outing = {
  id: "out_weather",
  startsAt: `${addDaysToDateKey(today, 3)}T10:00:00+09:00`,
  latitude: 37.5,
  longitude: 127,
};
const previousPayload = {
  date: addDaysToDateKey(today, 3),
  minTemperature: 20,
  maxTemperature: 28,
  precipitationProbability: 30,
  uvIndex: 5,
  uvLabel: "자외선 보통",
  condition: "구름",
  source: "Open-Meteo",
};

function forecastResponse(days = 16) {
  const time = Array.from({ length: days }, (_, index) =>
    addDaysToDateKey(today, index),
  );
  return new Response(
    JSON.stringify({
      daily: {
        time,
        weather_code: time.map(() => 1),
        temperature_2m_min: time.map(() => 24),
        temperature_2m_max: time.map(() => 31),
        precipitation_probability_max: time.map(() => 10),
        uv_index_max: time.map(() => 7),
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const failingFetch = async () => new Response("{}", { status: 503 });

function memoryCache(initial) {
  const writes = [];
  return {
    writes,
    readCache: async () => initial,
    writeCache: async (payload, fetchedAt) => {
      writes.push({ payload, fetchedAt });
    },
  };
}

test("예보 호출 실패와 '예보에 날짜 없음'을 구분한다", async () => {
  await assert.rejects(
    getForecastWeather(outing, failingFetch),
    WeatherFetchError,
  );
  await assert.rejects(
    getForecastWeather(outing, async () => {
      throw new Error("timeout");
    }),
    WeatherFetchError,
  );
  await assert.rejects(
    getForecastWeather(
      outing,
      async () => new Response("not json", { status: 200 }),
    ),
    WeatherFetchError,
  );
  // 예보가 이틀치만 오면 D+3은 정말 없는 날짜예요.
  assert.equal(
    await getForecastWeather(outing, async () => forecastResponse(2)),
    null,
  );
  const weather = await getForecastWeather(outing, async () =>
    forecastResponse(),
  );
  assert.equal(weather.date, addDaysToDateKey(today, 3));
  assert.equal(await getForecastWeatherOrNull(outing, failingFetch), null);
});

test("오래된 예보를 갱신하다 실패하면 이전 예보를 10분 더 쓴다", async () => {
  const cache = memoryCache({
    payload: previousPayload,
    fetchedAt: NOW - WEATHER_CACHE_TTL_MS - 60_000,
  });
  const result = await resolveOutingWeather({
    outing,
    ...cache,
    fetchImpl: failingFetch,
    now: NOW,
  });
  const retryFetchedAt = getWeatherRetryFetchedAt(NOW);
  assert.equal(
    retryFetchedAt,
    NOW - (WEATHER_CACHE_TTL_MS - WEATHER_FAILURE_TTL_MS),
  );
  assert.deepEqual(result, {
    weather: previousPayload,
    weatherStatus: "ok",
    weatherStamp: retryFetchedAt,
  });
  assert.deepEqual(cache.writes, [
    { payload: previousPayload, fetchedAt: retryFetchedAt },
  ]);
});

test("Worker의 백그라운드·강제 갱신도 실패하면 이전 예보를 지킨다", async () => {
  // stale-while-revalidate: 먼저 오래된 예보를 돌려주고 뒤에서 갱신해요.
  const stale = memoryCache({
    payload: previousPayload,
    fetchedAt: NOW - WEATHER_CACHE_TTL_MS - 60_000,
  });
  let scheduled = null;
  const first = await resolveOutingWeather({
    outing,
    ...stale,
    fetchImpl: failingFetch,
    now: NOW,
    scheduleRefresh: (refresh) => {
      scheduled = refresh;
    },
  });
  assert.equal(first.weather, previousPayload);
  assert.equal(stale.writes.length, 0);
  const refreshed = await scheduled();
  assert.equal(refreshed.weather, previousPayload);
  assert.deepEqual(stale.writes, [
    { payload: previousPayload, fetchedAt: getWeatherRetryFetchedAt(NOW) },
  ]);

  // 304 응답 뒤 갱신(force): 캐시를 읽되 신선도와 상관없이 다시 받아요.
  const forced = memoryCache({
    payload: previousPayload,
    fetchedAt: NOW - WEATHER_CACHE_TTL_MS - 60_000,
  });
  const forcedResult = await resolveOutingWeather({
    outing,
    ...forced,
    fetchImpl: failingFetch,
    now: NOW,
    force: true,
  });
  assert.equal(forcedResult.weather, previousPayload);
  assert.equal(forced.writes.length, 1);

  const forcedOk = memoryCache({ payload: previousPayload, fetchedAt: NOW });
  const okResult = await resolveOutingWeather({
    outing,
    ...forcedOk,
    fetchImpl: async () => forecastResponse(),
    now: NOW,
    force: true,
  });
  assert.equal(okResult.weather.maxTemperature, 31);
  assert.deepEqual(forcedOk.writes.map((write) => write.fetchedAt), [NOW]);
});

test("이전 예보가 없거나 예보에 날짜가 없을 때만 null을 캐시한다", async () => {
  const empty = memoryCache(null);
  const failed = await resolveOutingWeather({
    outing,
    ...empty,
    fetchImpl: failingFetch,
    now: NOW,
  });
  assert.deepEqual(failed, {
    weather: null,
    weatherStatus: "unavailable",
    weatherStamp: NOW,
  });
  assert.deepEqual(empty.writes, [{ payload: null, fetchedAt: NOW }]);

  const missingDate = memoryCache({
    payload: previousPayload,
    fetchedAt: NOW - WEATHER_CACHE_TTL_MS - 60_000,
  });
  const result = await resolveOutingWeather({
    outing,
    ...missingDate,
    fetchImpl: async () => forecastResponse(2),
    now: NOW,
  });
  assert.equal(result.weather, null);
  assert.equal(result.weatherStatus, "unavailable");
  assert.deepEqual(missingDate.writes, [{ payload: null, fetchedAt: NOW }]);
});
