import { createServer } from "node:http";

import { createStore } from "./database.mjs";
import {
  AI_BRIEFING_CACHE_TTL_MS,
  AI_BRIEFING_DAILY_LIMIT,
  AI_BRIEFING_MODEL,
  generateAiBriefing,
  getBriefingState,
} from "./ai-briefing.mjs";
import {
  estimateCrowd,
  estimateCurrentCrowd,
  getCurrentCrowdIntelligence,
  normalizeCrowdResponse,
} from "./crowd-intelligence.mjs";
import {
  getItemOption,
  ITEM_OPTIONS,
  MAX_ITEMS,
  normalizeCustomLabel,
  resolveItemSelection,
} from "./item-options.mjs";
import {
  getKoreaDateKey,
  isOutingToday,
  isPastOuting,
  normalizeStartsAt,
  parseDateInput,
} from "./kst-date.mjs";
import {
  apiError,
  asObject,
  buildOutingBundle,
  cleanText,
  enrichBundle,
  errorForException,
  etagMatches,
  formatOutingEtag,
  globalAiRateLimit,
  identityRateLimits,
  mapOutingRow,
  outingPlace,
  outingRateBucket,
  parseOutingInput,
  parseSummarySessions,
  pickClientIp,
  RATE_LIMITS,
  rateLimitWindowStart,
  resolveTrustProxy,
} from "./outing-rules.mjs";
import {
  getCustomPlace,
  getPlace,
  PLACES,
  searchPlaces,
} from "./places.mjs";
import {
  ACTIVITY_TYPES,
  getActivityType,
  getSmartPackingRecommendations,
  normalizeExpectedPeople,
} from "./smart-packing.mjs";
import {
  generateSummerEvents,
  getSummerEventSearchState,
  SUMMER_EVENT_CACHE_TTL_MS,
  SUMMER_EVENT_DAILY_LIMIT,
  SUMMER_EVENT_MODEL,
} from "./summer-events.mjs";
import {
  getCachedWeatherStamp,
  getForecastWeatherOrNull,
  getRegionalWeatherHighlights,
  getWeatherWindowStatus,
  resolveOutingWeather,
} from "./weather.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const MEMORY_CACHE_LIMIT = 500;
const CROWD_CACHE_TTL_MS = 5 * 60 * 1000;
const WEATHER_HIGHLIGHTS_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 브라우저가 CORS preflight 결과를 10분 동안 재사용해요(WebKit 상한).
const PREFLIGHT_MAX_AGE_SECONDS = "600";

const BASE_HEADERS = {
  "access-control-allow-headers":
    "authorization, content-type, if-none-match, x-chaengyeosum-etag, x-chaengyeosum-user-key",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "etag",
  "cache-control": "no-store",
};
const OUTING_CACHE_CONTROL = "private, no-cache";

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function empty(response, status, headers = {}) {
  response.writeHead(status, { ...BASE_HEADERS, ...headers });
  response.end();
}

function sendError(response, key, details) {
  const { status, body } = apiError(key, details);
  json(response, status, body);
}

/** 오래된 항목부터 지우는 크기 제한 Map이에요. */
class BoundedCache {
  constructor(limit = MEMORY_CACHE_LIMIT) {
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value);
    }
    return this;
  }
}

function header(request, name) {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
}

function bearerToken(request) {
  const authorization = header(request, "authorization");
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function anonymousUserKey(request) {
  const value = header(request, "x-chaengyeosum-user-key");
  return value.length <= 512 ? value : "";
}

function credentials(request) {
  return {
    token: bearerToken(request),
    anonymousUserKey: anonymousUserKey(request),
  };
}

/**
 * 요청 한도에 쓰는 클라이언트 IP예요. 프록시 헤더는 클라이언트가 마음대로
 * 보낼 수 있어서 trustProxy(TRUST_PROXY)가 켜져 있을 때만 읽어요. 앞단 프록시
 * 수만큼 X-Forwarded-For 오른쪽에서 세고, cloudflare 모드에서만
 * CF-Connecting-IP를 써요. 꺼져 있으면 소켓 주소예요.
 */
function clientIp(request, trustProxy) {
  return pickClientIp({
    trustProxy,
    cfConnectingIp: header(request, "cf-connecting-ip"),
    forwardedFor: header(request, "x-forwarded-for"),
    remoteAddress: request.socket?.remoteAddress ?? "",
  });
}

/** TRUST_PROXY 값을 읽어요. 알 수 없는 값이면 끄고 경고를 남겨요. */
function trustProxyPolicy(value) {
  const policy = resolveTrustProxy(value);
  if (policy) return policy;
  console.warn("trust_proxy_ignored", String(value));
  return resolveTrustProxy(false);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function weatherCacheFromRow(row) {
  if (row?.weather_fetched_at == null) return null;
  try {
    return {
      payload: JSON.parse(row.weather_payload),
      fetchedAt: Number(row.weather_fetched_at),
    };
  } catch {
    return null;
  }
}

function startsAtMs(startsAt) {
  return parseDateInput(startsAt) ?? Date.parse(startsAt);
}

export function createApiServer({
  dbFile,
  fetchImpl = fetch,
  weatherEnabled = true,
  openAiApiKey = process.env.OPENAI_API_KEY ?? "",
  aiModel = AI_BRIEFING_MODEL,
  eventModel = SUMMER_EVENT_MODEL,
  seoulOpenDataApiKey = process.env.SEOUL_OPEN_DATA_API_KEY ?? "",
  now = () => Date.now(),
  cleanupIntervalMs = CLEANUP_INTERVAL_MS,
  trustProxy = process.env.TRUST_PROXY,
  aiGlobalDailyLimit = process.env.AI_GLOBAL_DAILY_LIMIT,
}) {
  const proxyPolicy = trustProxyPolicy(trustProxy);
  const store = createStore(dbFile);
  const aiBriefingCache = new BoundedCache();
  const crowdCache = new BoundedCache();
  const regionalWeatherCache = new BoundedCache();
  const summerEventCache = new BoundedCache();

  // 시작할 때와 하루마다 오래된 모임·사용량 기록을 정리해요.
  const runCleanup = () => {
    try {
      store.cleanup(now());
    } catch (error) {
      console.error("cleanup_failed", error?.message ?? error);
    }
  };
  runCleanup();
  const cleanupTimer =
    cleanupIntervalMs > 0 ? setInterval(runCleanup, cleanupIntervalMs) : null;
  cleanupTimer?.unref?.();

  /**
   * 한도 항목을 차례로 소비해요. identityLimit 항목은 IP 버킷과(있으면)
   * 사용자 키 버킷으로 펼쳐요. 하나라도 넘으면 앞에서 올린 값은 되돌려요.
   */
  async function consumeLimits(request, entries) {
    const resolved = [];
    for (const entry of entries) {
      if (entry.identity) {
        resolved.push(
          ...(await identityRateLimits(entry.identity, {
            userKey: anonymousUserKey(request),
            ip: clientIp(request, proxyPolicy),
          })),
        );
      } else {
        resolved.push(entry);
      }
    }
    const { limited } = store.consumeRateLimits(
      resolved,
      rateLimitWindowStart(now()),
    );
    return limited?.error ?? null;
  }

  function identityLimit(config) {
    return { identity: config };
  }

  function resolveWeather(outing, outingRow, nowMs) {
    return resolveOutingWeather({
      outing,
      readCache: () => weatherCacheFromRow(outingRow),
      // 예보를 받는 동안 날짜·장소가 바뀌었으면 쓰지 않아요.
      writeCache: (payload, fetchedAt) =>
        store.putWeatherCache(outing, payload, fetchedAt),
      fetchImpl,
      now: nowMs,
      enabled: weatherEnabled,
    });
  }

  async function buildEnrichedBundle(access, nowMs = now()) {
    const { outingRow, viewer } = access;
    const rows = store.getBundleRows(outingRow.id, viewer?.id ?? null);
    const bundle = buildOutingBundle({
      outingRow,
      ...rows,
      viewer,
      now: nowMs,
    });
    const weatherInfo = await resolveWeather(bundle.outing, outingRow, nowMs);
    return {
      bundle: enrichBundle(bundle, weatherInfo),
      etag: formatOutingEtag({
        revision: outingRow.revision,
        weatherStamp: weatherInfo.weatherStamp,
        viewerId: viewer?.id ?? null,
      }),
    };
  }

  async function loadEnrichedBundle(outingId, creds) {
    const access = store.resolveAccess(outingId, creds);
    if (access.status !== "ok") return null;
    return buildEnrichedBundle(access);
  }

  /** 참여자 권한이 필요한 요청의 공통 확인이에요. */
  function requireParticipant(response, outingId, request) {
    const access = store.resolveAccess(outingId, credentials(request));
    if (access.status === "not_found") {
      sendError(response, "not_found");
      return null;
    }
    if (access.status !== "ok" || !access.viewer) {
      sendError(response, "not_participant");
      return null;
    }
    return access;
  }

  async function getOuting(request, response, outingId, url) {
    const access = store.resolveAccess(outingId, {
      ...credentials(request),
      inviteCode: url.searchParams.get("invite") ?? "",
    });
    if (access.status === "not_found") return sendError(response, "not_found");
    if (access.status === "forbidden") {
      return sendError(response, "invite_required");
    }

    const nowMs = now();
    // Worker와 같이 If-None-Match를 먼저 보고, 없으면 x-chaengyeosum-etag를 써요.
    const ifNoneMatch =
      header(request, "if-none-match") ||
      header(request, "x-chaengyeosum-etag");
    if (ifNoneMatch) {
      const cached = weatherCacheFromRow(access.outingRow);
      const weatherStamp = getCachedWeatherStamp({
        weatherStatus: getWeatherWindowStatus(
          access.outingRow.starts_at,
          nowMs,
        ),
        cachePayload: cached?.payload ?? null,
        cacheFetchedAt: cached?.fetchedAt ?? null,
        now: nowMs,
        enabled: weatherEnabled,
      });
      if (weatherStamp != null) {
        const etag = formatOutingEtag({
          revision: access.outingRow.revision,
          weatherStamp,
          viewerId: access.viewer?.id ?? null,
        });
        if (etagMatches(ifNoneMatch, etag)) {
          return empty(response, 304, {
            etag,
            "cache-control": OUTING_CACHE_CONTROL,
          });
        }
      }
    }

    const { bundle, etag } = await buildEnrichedBundle(access, nowMs);
    json(response, 200, bundle, {
      etag,
      "cache-control": OUTING_CACHE_CONTROL,
    });
  }

  async function createOuting(request, response) {
    const body = asObject(await readBody(request));
    const parsed = parseOutingInput(body, { partial: false, now: now() });
    if (parsed.error) return sendError(response, parsed.error);
    const items = resolveItemSelection(body.itemKeys, body.customItems);
    if (items.length === 0) return sendError(response, "no_items");

    const limited = await consumeLimits(request, [
      identityLimit(RATE_LIMITS.createOuting),
    ]);
    if (limited) return sendError(response, limited);

    const userKey = anonymousUserKey(request);
    const created = store.createOuting({
      values: parsed.values,
      items,
      anonymousUserKey: userKey,
      avatarKey: body.avatarKey,
    });
    const loaded = await loadEnrichedBundle(created.outingId, {
      token: created.session.token,
      anonymousUserKey: userKey,
    });
    json(response, 201, {
      session: created.session,
      outing: loaded?.bundle ?? null,
    });
  }

  async function joinOuting(request, response, outingId) {
    const body = asObject(await readBody(request));
    const name = cleanText(body.name, 10);
    const inviteCode = cleanText(body.inviteCode, 64);
    if (!name || !inviteCode) return sendError(response, "invalid_name");

    const limited = await consumeLimits(request, [
      identityLimit(RATE_LIMITS.joinOuting),
    ]);
    if (limited) return sendError(response, limited);

    const userKey = anonymousUserKey(request);
    const result = store.joinOuting({
      outingId,
      inviteCode,
      name,
      anonymousUserKey: userKey,
      avatarKey: body.avatarKey,
      claimItemId:
        typeof body.claimItemId === "string" && body.claimItemId.length <= 64
          ? body.claimItemId
          : "",
    });
    if (result.error) return sendError(response, result.error);
    const loaded = await loadEnrichedBundle(outingId, {
      token: result.session.token,
      anonymousUserKey: userKey,
    });
    json(response, result.created ? 201 : 200, {
      session: result.session,
      outing: loaded?.bundle ?? null,
      claimResult: result.claimResult,
    });
  }

  async function updateOuting(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    if (!access.isCreator) return sendError(response, "not_creator");
    const body = asObject(await readBody(request));
    const parsed = parseOutingInput(body, { partial: true, now: now() });
    if (parsed.error) return sendError(response, parsed.error);
    store.updateOuting({
      outingRow: access.outingRow,
      viewer: access.viewer,
      values: parsed.values,
    });
    const loaded = await loadEnrichedBundle(outingId, credentials(request));
    json(response, 200, { outing: loaded?.bundle ?? null });
  }

  function resetInviteCode(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    if (!access.isCreator) return sendError(response, "not_creator_invite");
    const result = store.resetInviteCode(outingId);
    json(response, 200, { inviteCode: result.inviteCode });
  }

  function deleteOuting(request, response, outingId) {
    const access = store.resolveAccess(outingId, credentials(request));
    if (access.status === "not_found") return sendError(response, "not_found");
    if (access.status !== "ok" || !access.isCreator) {
      return sendError(response, "not_creator_delete");
    }
    const result = store.deleteOuting(outingId);
    if (result.error) return sendError(response, result.error);
    json(response, 200, { ok: true });
  }

  async function getAiBriefing(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const nowMs = now();
    if (isPastOuting(access.outingRow.starts_at, nowMs)) {
      return sendError(response, "outing_past");
    }
    if (!openAiApiKey) return sendError(response, "ai_unavailable");

    const { bundle } = await buildEnrichedBundle(access, nowMs);
    const { stateHash } = await getBriefingState(bundle);
    const cacheKey = `${outingId}:${stateHash}`;
    const cached = aiBriefingCache.get(cacheKey);
    if (cached && cached.meta.expiresAt > nowMs) {
      return json(response, 200, {
        briefing: cached.briefing,
        meta: { ...cached.meta, cached: true },
      });
    }

    // OpenAI를 부르기 전에 사용량을 올려 실패한 시도도 집계해요.
    const limited = await consumeLimits(request, [
      {
        bucket: outingRateBucket(RATE_LIMITS.aiBriefing.bucket, outingId),
        limit: AI_BRIEFING_DAILY_LIMIT,
        error: "ai_daily_limit",
      },
      // 서비스 전체 한도가 다 찼을 때 뒤 버킷을 올렸다 되돌리는 쓰기가 없게
      // 사람 기준 한도보다 먼저 확인해요.
      globalAiRateLimit(aiGlobalDailyLimit, "ai_global_limit"),
      identityLimit(RATE_LIMITS.aiBriefing),
    ]);
    if (limited) return sendError(response, limited);

    try {
      const generated = await generateAiBriefing({
        bundle,
        apiKey: openAiApiKey,
        fetchImpl,
        model: aiModel,
      });
      const generatedAt = Date.now();
      const result = {
        briefing: generated.briefing,
        meta: {
          cached: false,
          generatedAt,
          expiresAt: generatedAt + AI_BRIEFING_CACHE_TTL_MS,
          model: generated.model,
          stateHash: generated.stateHash,
        },
      };
      aiBriefingCache.set(cacheKey, result);
      json(response, 201, result);
    } catch (error) {
      console.error("ai_briefing_generation_failed", {
        outingId,
        code: error?.message ?? "unknown",
        status: error?.status ?? null,
        apiCode: error?.apiCode ?? null,
      });
      sendError(response, "ai_failed");
    }
  }

  async function getPlaceIntelligence(request, response, outingId, url) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const nowMs = now();
    const outing = mapOutingRow(access.outingRow, nowMs);
    const place = outingPlace(outing);

    // 이미 출시된 앱은 basis를 모르고 늘 '지금' 혼잡도로 보여줘서,
    // ?basis=outing을 보낸 요청에만 모임 시각 기준 예상을 돌려줘요.
    const wantsOutingBasis = url?.searchParams.get("basis") === "outing";
    if (wantsOutingBasis && !isOutingToday(outing.startsAt, nowMs)) {
      // 오늘이 아닌 모임은 모임 시각 기준으로 혼잡도를 예상해요.
      const crowd = estimateCrowd(place, {
        targetTime: new Date(startsAtMs(outing.startsAt)),
        basis: "outing",
        computedAt: new Date(nowMs),
      });
      return json(response, 200, {
        crowd,
        meta: { cached: false, expiresAt: nowMs + CROWD_CACHE_TTL_MS },
      });
    }

    const cached = crowdCache.get(place.id);
    if (cached && cached.expiresAt > nowMs) {
      return json(response, 200, {
        crowd: normalizeCrowdResponse(cached.crowd, {
          basis: "now",
          targetTime: nowMs,
          now: nowMs,
        }),
        meta: { cached: true, expiresAt: cached.expiresAt },
      });
    }

    const crowd = await getCurrentCrowdIntelligence({
      place,
      apiKey: seoulOpenDataApiKey,
      fetchImpl,
      now: new Date(nowMs),
    });
    const cacheTtlMs =
      crowd.mode === "estimate" && crowd.liveSupported
        ? 30 * 1000
        : CROWD_CACHE_TTL_MS;
    const expiresAt = nowMs + cacheTtlMs;
    crowdCache.set(place.id, { crowd, expiresAt });
    json(response, 200, {
      crowd: normalizeCrowdResponse(crowd, { basis: "now", now: nowMs }),
      meta: { cached: false, expiresAt },
    });
  }

  async function getSummerEvents(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const nowMs = now();
    if (isPastOuting(access.outingRow.starts_at, nowMs)) {
      return sendError(response, "outing_past");
    }
    if (!openAiApiKey) return sendError(response, "events_unavailable");

    const outing = mapOutingRow(access.outingRow, nowMs);
    const place = outingPlace(outing);
    const { searchKey } = await getSummerEventSearchState({
      outing,
      place,
      now: new Date(nowMs),
    });
    const cacheKey = `${outingId}:${searchKey}`;
    const cached = summerEventCache.get(cacheKey);
    if (cached && cached.meta.expiresAt > nowMs) {
      return json(response, 200, {
        events: cached.events,
        meta: { ...cached.meta, cached: true },
      });
    }

    const limited = await consumeLimits(request, [
      {
        bucket: outingRateBucket(RATE_LIMITS.summerEvents.bucket, outingId),
        limit: SUMMER_EVENT_DAILY_LIMIT,
        error: "events_daily_limit",
      },
      // 서비스 전체 한도가 다 찼을 때 뒤 버킷을 올렸다 되돌리는 쓰기가 없게
      // 사람 기준 한도보다 먼저 확인해요.
      globalAiRateLimit(aiGlobalDailyLimit, "events_global_limit"),
      identityLimit(RATE_LIMITS.summerEvents),
    ]);
    if (limited) return sendError(response, limited);

    try {
      const generated = await generateSummerEvents({
        outing,
        place,
        apiKey: openAiApiKey,
        fetchImpl,
        model: eventModel,
        now: new Date(nowMs),
      });
      const generatedAt = Date.now();
      const result = {
        events: generated.result,
        meta: {
          cached: false,
          generatedAt,
          expiresAt: generatedAt + SUMMER_EVENT_CACHE_TTL_MS,
          model: generated.model,
          searchKey: generated.searchKey,
          sourceCount: generated.sourceCount,
        },
      };
      summerEventCache.set(cacheKey, result);
      json(response, 201, result);
    } catch (error) {
      console.error("summer_event_search_failed", {
        outingId,
        code: error?.message ?? "unknown",
        status: error?.status ?? null,
        apiCode: error?.apiCode ?? null,
      });
      sendError(response, "events_failed");
    }
  }

  async function getPackingRecommendations(response, url) {
    const place =
      getPlace(url.searchParams.get("placeId")) ??
      getCustomPlace({
        name: url.searchParams.get("placeName"),
        latitude: url.searchParams.get("latitude"),
        longitude: url.searchParams.get("longitude"),
      });
    const startsAt = normalizeStartsAt(url.searchParams.get("startsAt"));
    const activityType = getActivityType(url.searchParams.get("activityType"));
    const expectedPeople = normalizeExpectedPeople(
      url.searchParams.get("expectedPeople"),
    );
    if (!place || !startsAt) return sendError(response, "invalid_preview");

    let weatherStatus = getWeatherWindowStatus(startsAt, now());
    let weather = null;
    if (weatherStatus === "ok") {
      weather = weatherEnabled
        ? await getForecastWeatherOrNull(
            {
              id: "preview",
              startsAt,
              latitude: place.latitude,
              longitude: place.longitude,
            },
            fetchImpl,
          )
        : null;
      weatherStatus = weather ? "ok" : "unavailable";
    }
    json(response, 200, {
      activityType,
      expectedPeople,
      weather,
      weatherStatus,
      recommendations: getSmartPackingRecommendations({
        activityType,
        place,
        weather,
        expectedPeople,
      }),
    });
  }

  async function getCrowdHighlights(response) {
    const nowMs = now();
    const cached = crowdCache.get("crowd-highlights");
    if (cached && cached.expiresAt > nowMs) {
      return json(response, 200, cached.payload);
    }
    const places = await Promise.all(
      PLACES.filter((place) => place.seoulCrowdArea).map(async (place) => ({
        id: place.id,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        city: place.city,
        currentCrowd: await getCurrentCrowdIntelligence({
          place,
          apiKey: seoulOpenDataApiKey,
          fetchImpl,
          now: new Date(nowMs),
        }),
      })),
    );
    const payload = { places, meta: { generatedAt: nowMs } };
    crowdCache.set("crowd-highlights", {
      payload,
      expiresAt: nowMs + CROWD_CACHE_TTL_MS,
    });
    json(response, 200, payload);
  }

  async function getWeatherHighlights(response) {
    const cacheKey = `today:${getKoreaDateKey(now())}`;
    const cached = regionalWeatherCache.get(cacheKey);
    if (cached && now() - cached.generatedAt < WEATHER_HIGHLIGHTS_TTL_MS) {
      return json(response, 200, {
        regions: cached.regions,
        meta: { ...cached.meta, cached: true },
      });
    }
    const result = weatherEnabled
      ? await getRegionalWeatherHighlights(fetchImpl)
      : { regions: [], meta: { generatedAt: Date.now(), date: "" } };
    if (result.regions.length > 0) {
      regionalWeatherCache.set(cacheKey, {
        ...result,
        generatedAt: now(),
      });
    }
    json(response, 200, {
      ...result,
      meta: { ...result.meta, cached: false },
    });
  }

  async function getLocationWeather(response, url) {
    const latitude = Number(url.searchParams.get("latitude"));
    const longitude = Number(url.searchParams.get("longitude"));
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < 32 ||
      latitude > 39 ||
      longitude < 124 ||
      longitude > 132
    ) {
      return sendError(response, "invalid_location");
    }
    const date = getKoreaDateKey(now());
    const weather = weatherEnabled
      ? await getForecastWeatherOrNull(
          {
            id: `location-${latitude.toFixed(2)}-${longitude.toFixed(2)}`,
            startsAt: `${date}T12:00:00+09:00`,
            latitude: Number(latitude.toFixed(2)),
            longitude: Number(longitude.toFixed(2)),
          },
          fetchImpl,
        )
      : null;
    json(response, 200, {
      weather,
      meta: { generatedAt: Date.now(), locationBased: true },
    });
  }

  async function addItem(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const body = asObject(await readBody(request));
    const option =
      typeof body.optionKey === "string" ? getItemOption(body.optionKey) : null;
    const customLabel = normalizeCustomLabel(body.label);
    const item =
      option ??
      (customLabel
        ? { key: null, label: customLabel, visual: "asset:item-custom-3d.png" }
        : null);
    if (!item) return sendError(response, "invalid_item");
    const result = store.addItem({ outingId, viewer: access.viewer, item });
    if (result.error) return sendError(response, result.error);
    json(response, 201, { ok: true, itemId: result.itemId });
  }

  async function updateItem(request, response, outingId, itemId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const body = asObject(await readBody(request));
    const result = store.updateItem({
      outingId,
      itemId,
      viewer: access.viewer,
      isCreator: access.isCreator,
      done: typeof body.done === "boolean" ? body.done : undefined,
      ownerId:
        body.ownerId === null || typeof body.ownerId === "string"
          ? body.ownerId
          : undefined,
    });
    if (result.error) return sendError(response, result.error, result);
    json(response, 200, { ok: true });
  }

  function deleteItem(request, response, outingId, itemId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const result = store.deleteItem({
      outingId,
      itemId,
      viewer: access.viewer,
      isCreator: access.isCreator,
    });
    if (result.error) return sendError(response, result.error);
    json(response, 200, { ok: true });
  }

  function completeMine(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const result = store.completeMyItems({ outingId, viewer: access.viewer });
    json(response, 200, { ok: true, completed: result.completed });
  }

  function randomize(request, response, outingId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const result = store.randomizeUnassigned({
      outingId,
      viewer: access.viewer,
    });
    if (result.error) return sendError(response, result.error);
    json(response, 200, { ok: true, assigned: result.assigned });
  }

  async function toggleReaction(request, response, outingId, eventId) {
    const access = requireParticipant(response, outingId, request);
    if (!access) return;
    const body = asObject(await readBody(request));
    const result = store.toggleEventReaction({
      outingId,
      eventId,
      viewer: access.viewer,
      reactionType: body.reactionType,
    });
    if (result.error) return sendError(response, result.error);
    json(response, 200, { ok: true, reaction: result.reaction });
  }

  async function getOutingSummaries(request, response) {
    const sessions = parseSummarySessions(await readBody(request));
    // missing: 삭제됐거나 보관 기간이 지나 모임 행이 없는 outingId예요.
    const { summaries, missing } = store.getOutingSummaries(
      sessions,
      anonymousUserKey(request),
      now(),
    );
    json(response, 200, { summaries, missing });
  }

  const routes = [
    ["PATCH", /^\/api\/outings\/([^/]+)$/, updateOuting],
    ["DELETE", /^\/api\/outings\/([^/]+)$/, deleteOuting],
    ["POST", /^\/api\/outings\/([^/]+)\/join$/, joinOuting],
    ["POST", /^\/api\/outings\/([^/]+)\/invite-code$/, resetInviteCode],
    ["POST", /^\/api\/outings\/([^/]+)\/ai-briefing$/, getAiBriefing],
    [
      "GET",
      /^\/api\/outings\/([^/]+)\/place-intelligence$/,
      getPlaceIntelligence,
    ],
    ["POST", /^\/api\/outings\/([^/]+)\/summer-events$/, getSummerEvents],
    ["POST", /^\/api\/outings\/([^/]+)\/items$/, addItem],
    ["PATCH", /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/, updateItem],
    ["DELETE", /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/, deleteItem],
    ["POST", /^\/api\/outings\/([^/]+)\/complete-mine$/, completeMine],
    ["POST", /^\/api\/outings\/([^/]+)\/randomize$/, randomize],
    [
      "POST",
      /^\/api\/outings\/([^/]+)\/events\/([^/]+)\/reaction$/,
      toggleReaction,
    ],
  ];

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      empty(response, 204, {
        "access-control-max-age": PREFLIGHT_MAX_AGE_SECONDS,
      });
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/api/health") {
        json(response, 200, { ok: true, service: "chaengyeosum-api" });
        return;
      }

      if (request.method === "GET" && path === "/api/places") {
        const nowDate = new Date(now());
        json(response, 200, {
          places: PLACES.map((place) => ({
            id: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            city: place.city,
            category: place.category,
            tagline: place.tagline,
            highlights: place.highlights,
            summerTip: place.summerTip,
            imageUrl: place.imageUrl,
            officialUrl: place.officialUrl,
            currentCrowd: estimateCurrentCrowd(place, nowDate),
          })),
        });
        return;
      }

      if (request.method === "GET" && path === "/api/crowd-highlights") {
        await getCrowdHighlights(response);
        return;
      }

      if (request.method === "GET" && path === "/api/weather-highlights") {
        await getWeatherHighlights(response);
        return;
      }

      if (request.method === "GET" && path === "/api/location-weather") {
        await getLocationWeather(response, url);
        return;
      }

      if (request.method === "GET" && path === "/api/place-search") {
        json(response, 200, {
          places: await searchPlaces(url.searchParams.get("q"), fetchImpl),
        });
        return;
      }

      if (request.method === "GET" && path === "/api/item-options") {
        json(response, 200, {
          options: ITEM_OPTIONS,
          maxItems: MAX_ITEMS,
          activities: ACTIVITY_TYPES,
        });
        return;
      }

      if (
        request.method === "GET" &&
        path === "/api/packing-recommendations"
      ) {
        await getPackingRecommendations(response, url);
        return;
      }

      if (request.method === "POST" && path === "/api/outings") {
        await createOuting(request, response);
        return;
      }

      if (request.method === "GET" && path === "/api/me/outings") {
        const userKey = anonymousUserKey(request);
        if (!userKey) {
          sendError(response, "user_key_required");
          return;
        }
        json(response, 200, {
          sessions: store.listMySessions(userKey, now()),
        });
        return;
      }

      if (request.method === "POST" && path === "/api/outing-summaries") {
        await getOutingSummaries(request, response);
        return;
      }

      const outingMatch = path.match(/^\/api\/outings\/([^/]+)$/);
      if (request.method === "GET" && outingMatch) {
        await getOuting(request, response, outingMatch[1], url);
        return;
      }

      for (const [method, pattern, handler] of routes) {
        if (request.method !== method) continue;
        const match = path.match(pattern);
        if (!match) continue;
        await handler(request, response, ...match.slice(1), url);
        return;
      }

      sendError(response, "not_supported");
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const { status, body } = errorForException(error);
      json(response, status, body);
    }
  });

  return {
    server,
    close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      store.close();
    },
  };
}
