// Cloudflare Worker(worker/index.mjs)를 Node에서 직접 돌려 보는 테스트예요.
// D1은 node:sqlite 위의 작은 shim으로, Open-Meteo는 fetch 스텁으로 대신해요.
// 공용 로직만 부르는 테스트로는 잡히지 않는 Worker 배선(304 분기의 강제 갱신,
// D1 writeCache의 바인딩 순서, IP 한도 키)을 지켜요.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../worker/index.mjs";
import {
  addDaysToDateKey,
  getKoreaDateKey,
  getOutingDateKey,
} from "./kst-date.mjs";
import { formatOutingEtag, RATE_LIMITS } from "./outing-rules.mjs";
import { SQL } from "./outing-sql.mjs";
import {
  getWeatherRetryFetchedAt,
  WEATHER_CACHE_TTL_MS,
} from "./weather.mjs";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// D1 shim

function toSqliteValue(value) {
  if (value === undefined) {
    throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported");
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  // D1은 외래 키를 항상 검사해요.
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
  }
  const totalChanges = () =>
    sqlite.prepare("SELECT total_changes() AS n").get().n;

  const execute = (sql, params) => {
    const before = totalChanges();
    const results = sqlite.prepare(sql).all(...params.map(toSqliteValue));
    return {
      success: true,
      results,
      meta: { changes: totalChanges() - before },
    };
  };

  const prepared = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepared(sql, values),
    first: async (column) => {
      const row = execute(sql, params).results[0] ?? null;
      return column ? (row?.[column] ?? null) : row;
    },
    all: async () => execute(sql, params),
    run: async () => execute(sql, params),
  });

  return {
    sqlite,
    prepare: (sql) => prepared(sql),
    // D1 batch는 한 트랜잭션이에요.
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          execute(statement.sql, statement.params),
        );
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Open-Meteo 스텁

function createWeatherStub() {
  const state = { mode: "ok", maxTemperature: 31, calls: 0, gate: null };

  const forecast = (maxTemperature) => {
    const today = getKoreaDateKey();
    const time = Array.from({ length: 16 }, (_, index) =>
      addDaysToDateKey(today, index),
    );
    return {
      daily: {
        time,
        weather_code: time.map(() => 1),
        temperature_2m_min: time.map(() => 22),
        temperature_2m_max: time.map(() => maxTemperature),
        precipitation_probability_max: time.map(() => 10),
        uv_index_max: time.map(() => 7),
      },
    };
  };

  const fetchImpl = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname !== "api.open-meteo.com") {
      throw new Error(`unexpected outbound fetch: ${url.href}`);
    }
    state.calls += 1;
    // 호출이 시작된 때의 설정으로 응답해요(멈춰 둔 호출도 마찬가지예요).
    const { mode, maxTemperature } = state;
    if (state.gate) {
      const gate = state.gate;
      state.gate = null;
      gate.markStarted();
      await gate.released;
    }
    if (mode === "fail") return new Response("upstream down", { status: 503 });
    return Response.json(forecast(maxTemperature));
  };

  /** 다음 Open-Meteo 호출을 release()할 때까지 멈춰 둬요. */
  const holdNext = () => {
    const gate = {};
    const started = new Promise((resolve) => {
      gate.markStarted = resolve;
    });
    gate.released = new Promise((resolve) => {
      gate.release = resolve;
    });
    state.gate = gate;
    return { started, release: () => gate.release() };
  };

  return { state, fetchImpl, holdNext };
}

// ---------------------------------------------------------------------------
// 하네스

function futureStartsAt(daysAhead, time = "10:00") {
  return `${addDaysToDateKey(getKoreaDateKey(), daysAhead)}T${time}:00+09:00`;
}

async function withWorker(run) {
  const db = createD1();
  const weather = createWeatherStub();
  const pending = [];
  const ctx = {
    waitUntil: (promise) => pending.push(promise),
    passThroughOnException: () => {},
  };
  const env = { DB: db, AI_GLOBAL_DAILY_LIMIT: "600" };

  const call = async (
    path,
    { method = "GET", token, userKey, body, headers = {}, ip = "198.51.100.1" } = {},
  ) => {
    const request = new Request(`https://worker.test${path}`, {
      method,
      headers: {
        "cf-connecting-ip": ip,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(userKey ? { "x-chaengyeosum-user-key": userKey } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const response = await worker.fetch(request, env, ctx);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };

  /** ctx.waitUntil로 넘긴 백그라운드 작업이 다 끝날 때까지 기다려요. */
  const drain = async () => {
    while (pending.length > 0) {
      await Promise.allSettled(pending.splice(0));
    }
  };

  const createOuting = async (overrides = {}, options = {}) => {
    const result = await call("/api/outings", {
      method: "POST",
      userKey: "worker-test-user",
      ...options,
      body: {
        title: "Worker 날씨 확인",
        placeId: "seoul-forest",
        startsAt: futureStartsAt(3),
        creatorName: "모임장",
        itemKeys: ["water", "snack"],
        ...overrides,
      },
    });
    return result;
  };

  const weatherRow = (outingId) =>
    db.sqlite
      .prepare(
        "SELECT payload, fetched_at FROM weather_cache WHERE outing_id = ?",
      )
      .get(outingId) ?? null;

  const setWeatherFetchedAt = (outingId, fetchedAt) =>
    db.sqlite
      .prepare("UPDATE weather_cache SET fetched_at = ? WHERE outing_id = ?")
      .run(fetchedAt, outingId);

  const revision = (outingId) =>
    db.sqlite.prepare("SELECT revision FROM outings WHERE id = ?").get(outingId)
      .revision;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = weather.fetchImpl;
  try {
    await run({
      call,
      createOuting,
      db,
      drain,
      revision,
      setWeatherFetchedAt,
      weather,
      weatherRow,
    });
    await drain();
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
}

/** 예보를 받아 둔 모임을 만들고 캐시를 만료(31분 전)시켜요. */
async function createOutingWithStaleWeather(h) {
  h.weather.state.maxTemperature = 31;
  const created = await h.createOuting();
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await h.drain();
  const outingId = created.body.outing.outing.id;
  const { token, participantId } = created.body.session;
  assert.equal(created.body.outing.weatherStatus, "ok");
  assert.equal(JSON.parse(h.weatherRow(outingId).payload).maxTemperature, 31);

  const staleAt = Date.now() - WEATHER_CACHE_TTL_MS - 60_000;
  h.setWeatherFetchedAt(outingId, staleAt);
  const etag = formatOutingEtag({
    revision: h.revision(outingId),
    weatherStamp: staleAt,
    viewerId: participantId,
  });
  return { outingId, token, staleAt, etag };
}

// ---------------------------------------------------------------------------
// 날씨

test("Worker 304 응답의 강제 갱신이 실패해도 이전 예보를 지키고 10분 뒤 다시 시도한다", async () => {
  await withWorker(async (h) => {
    const { outingId, token, etag } = await createOutingWithStaleWeather(h);
    h.weather.state.mode = "fail";
    const callsBefore = h.weather.state.calls;

    const startedAt = Date.now();
    const notModified = await h.call(`/api/outings/${outingId}`, {
      token,
      headers: { "if-none-match": etag },
    });
    const endedAt = Date.now();
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.get("etag"), etag);

    await h.drain();
    assert.equal(h.weather.state.calls, callsBefore + 1);
    const row = h.weatherRow(outingId);
    assert.equal(JSON.parse(row.payload).maxTemperature, 31);
    // 이전 예보를 20분 전에 받은 것으로 적어 10분 뒤 다시 시도해요.
    assert.ok(
      row.fetched_at >= getWeatherRetryFetchedAt(startedAt) &&
        row.fetched_at <= getWeatherRetryFetchedAt(endedAt),
      `fetched_at=${row.fetched_at}`,
    );

    const next = await h.call(`/api/outings/${outingId}`, { token });
    assert.equal(next.status, 200);
    assert.equal(next.body.weatherStatus, "ok");
    assert.equal(next.body.weather.maxTemperature, 31);
    // 재시도 시각 전이라 Open-Meteo를 다시 부르지 않아요.
    await h.drain();
    assert.equal(h.weather.state.calls, callsBefore + 1);
  });
});

test("Worker 304 응답의 강제 갱신이 성공하면 새 예보를 지금 시각으로 저장한다", async () => {
  await withWorker(async (h) => {
    const { outingId, token, etag } = await createOutingWithStaleWeather(h);
    h.weather.state.maxTemperature = 35;
    const callsBefore = h.weather.state.calls;

    const startedAt = Date.now();
    const notModified = await h.call(`/api/outings/${outingId}`, {
      token,
      headers: { "if-none-match": etag },
    });
    assert.equal(notModified.status, 304);
    await h.drain();
    const endedAt = Date.now();

    assert.equal(h.weather.state.calls, callsBefore + 1);
    const row = h.weatherRow(outingId);
    assert.equal(JSON.parse(row.payload).maxTemperature, 35);
    assert.ok(
      row.fetched_at >= startedAt && row.fetched_at <= endedAt,
      `fetched_at=${row.fetched_at}`,
    );

    // ETag가 바뀌어 다음 폴링은 새 예보를 받아요.
    const next = await h.call(`/api/outings/${outingId}`, {
      token,
      headers: { "if-none-match": etag },
    });
    assert.equal(next.status, 200);
    assert.equal(next.body.weather.maxTemperature, 35);
    assert.notEqual(next.headers.get("etag"), etag);
  });
});

test("Worker 백그라운드 갱신 중에 날짜가 바뀌면 늦게 끝난 갱신이 새 예보를 덮지 않는다", async () => {
  await withWorker(async (h) => {
    const { outingId, token } = await createOutingWithStaleWeather(h);

    // 만료된 예보를 먼저 응답하고 뒤에서 갱신해요. 그 갱신을 멈춰 둬요.
    h.weather.state.maxTemperature = 20;
    const held = h.weather.holdNext();
    const stale = await h.call(`/api/outings/${outingId}`, { token });
    assert.equal(stale.status, 200);
    assert.equal(stale.body.weather.maxTemperature, 31);
    await held.started;

    h.weather.state.maxTemperature = 40;
    const newStartsAt = futureStartsAt(5);
    const moved = await h.call(`/api/outings/${outingId}`, {
      method: "PATCH",
      token,
      body: { startsAt: newStartsAt },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.outing.weather.maxTemperature, 40);

    held.release();
    await h.drain();
    const payload = JSON.parse(h.weatherRow(outingId).payload);
    assert.equal(payload.date, getOutingDateKey(newStartsAt));
    assert.equal(payload.maxTemperature, 40);
  });
});

test("Worker 백그라운드 갱신 중에 모임이 지워지면 날씨 캐시를 다시 만들지 않는다", async () => {
  await withWorker(async (h) => {
    const { outingId, token } = await createOutingWithStaleWeather(h);

    const held = h.weather.holdNext();
    const stale = await h.call(`/api/outings/${outingId}`, { token });
    assert.equal(stale.status, 200);
    await held.started;

    const deleted = await h.call(`/api/outings/${outingId}`, {
      method: "DELETE",
      token,
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    held.release();
    await h.drain();
    assert.equal(h.weatherRow(outingId), null);
  });
});

// ---------------------------------------------------------------------------
// 요청 제한

test("Worker는 같은 /64의 IPv6 주소를 바꿔 가며 보내도 한 IP 한도로 센다", async () => {
  const { ipLimit } = RATE_LIMITS.createOuting;
  await withWorker(async (h) => {
    // 예보 범위 밖 날짜라 Open-Meteo를 부르지 않아요.
    const create = (ip, userKey) =>
      h.createOuting({ startsAt: futureStartsAt(30) }, { ip, userKey });
    for (let index = 0; index < ipLimit; index += 1) {
      const result = await create(
        `2001:db8:1:2:${index.toString(16)}::${index + 1}`,
        `worker-v6-${index}`,
      );
      assert.equal(result.status, 201, JSON.stringify(result.body));
    }
    const limited = await create("2001:db8:1:2:ffff::1", "worker-v6-new");
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, {
      error: "오늘은 요청이 너무 많아요. 내일 다시 시도해 주세요.",
      code: "rate_limited",
    });
    assert.equal((await create("2001:db8:1:3::1", "worker-v6-new")).status, 201);
    assert.equal(h.weather.state.calls, 0);
  });
});

// ---------------------------------------------------------------------------
// revision · ETag

test("Worker는 아무것도 바뀌지 않은 쓰기 요청에서 revision을 올리지 않아 304를 지킨다", async () => {
  await withWorker(async (h) => {
    // 예보 범위 밖 날짜라 날씨 스탬프가 바뀌지 않아요. 물·간식은 모임장에게
    // 자동 배정되므로, 담당자가 없는 준비물로 시작해요.
    const created = await h.createOuting({
      startsAt: futureStartsAt(30),
      itemKeys: ["mat", "towel"],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const outingId = created.body.outing.outing.id;
    const { token } = created.body.session;
    const [first, second] = created.body.outing.items;

    const initial = await h.call(`/api/outings/${outingId}`, { token });
    const etag = initial.headers.get("etag");
    assert.ok(etag);
    const startRevision = h.revision(outingId);

    // 맡은 준비물이 없을 때 "내 준비 끝내기"는 아무것도 바꾸지 않아요.
    const noop = await h.call(`/api/outings/${outingId}/complete-mine`, {
      method: "POST",
      token,
    });
    assert.equal(noop.status, 200);
    assert.equal(noop.body.completed, 0);
    assert.equal(h.revision(outingId), startRevision);

    // 새 앱은 조건부 헤더 대신 x-chaengyeosum-etag로 버전을 보내요.
    const unchanged = await h.call(`/api/outings/${outingId}`, {
      token,
      headers: { "x-chaengyeosum-etag": etag },
    });
    assert.equal(unchanged.status, 304);
    const legacy = await h.call(`/api/outings/${outingId}`, {
      token,
      headers: { "if-none-match": etag },
    });
    assert.equal(legacy.status, 304);

    // 하나를 지우면 revision이 오르고, 마지막 하나 삭제 거절은 그대로예요.
    const removed = await h.call(`/api/outings/${outingId}/items/${first.id}`, {
      method: "DELETE",
      token,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const afterDelete = h.revision(outingId);
    assert.equal(afterDelete, startRevision + 1);
    const lastItem = await h.call(
      `/api/outings/${outingId}/items/${second.id}`,
      { method: "DELETE", token },
    );
    assert.equal(lastItem.status, 409);
    assert.equal(lastItem.body.code, "last_item");
    assert.equal(h.revision(outingId), afterDelete);

    // 실제로 바뀐 쓰기는 revision을 한 번만 올려요.
    const claimed = await h.call(
      `/api/outings/${outingId}/items/${second.id}`,
      {
        method: "PATCH",
        token,
        body: { ownerId: created.body.session.participantId },
      },
    );
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(h.revision(outingId), afterDelete + 1);
    const done = await h.call(`/api/outings/${outingId}/complete-mine`, {
      method: "POST",
      token,
    });
    assert.equal(done.body.completed, 1);
    assert.equal(h.revision(outingId), afterDelete + 2);
  });
});

test("Worker preflight는 x-chaengyeosum-etag 헤더를 허용하고 10분 동안 재사용된다", async () => {
  await withWorker(async (h) => {
    const preflight = await h.call("/api/outings/out_x", {
      method: "OPTIONS",
      headers: {
        origin: "https://chaengyeosum.apps.tossmini.com",
        "access-control-request-method": "GET",
        "access-control-request-headers":
          "authorization, x-chaengyeosum-etag, x-chaengyeosum-user-key",
      },
    });
    assert.ok(preflight.status === 204 || preflight.status === 200);
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /x-chaengyeosum-etag/,
    );
    assert.equal(preflight.headers.get("access-control-max-age"), "600");
  });
});

test("날씨 캐시는 더 최신 fetched_at으로만 덮어써 늦게 실패한 갱신이 새 예보를 되돌리지 않는다", async () => {
  await withWorker(async (h) => {
    const created = await h.createOuting({ startsAt: futureStartsAt(30) });
    const outing = created.body.outing.outing;
    const row = h.db.sqlite
      .prepare("SELECT starts_at, latitude, longitude FROM outings WHERE id = ?")
      .get(outing.id);
    const put = (payload, fetchedAt) =>
      h.db.sqlite
        .prepare(SQL.putWeather)
        .run(
          outing.id,
          JSON.stringify(payload),
          fetchedAt,
          outing.id,
          row.starts_at,
          row.latitude,
          row.longitude,
        );
    const now = Date.now();
    put({ maxTemperature: 31 }, now - WEATHER_CACHE_TTL_MS - 60_000);
    // 그사이 성공한 갱신이 새 예보를 저장해요.
    put({ maxTemperature: 33 }, now);
    // 먼저 시작했다가 늦게 실패한 갱신이 이전 예보를 다시 쓰려 해요.
    put({ maxTemperature: 31 }, getWeatherRetryFetchedAt(now));
    const cached = h.weatherRow(outing.id);
    assert.equal(JSON.parse(cached.payload).maxTemperature, 33);
    assert.equal(cached.fetched_at, now);
  });
});
