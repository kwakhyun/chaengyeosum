import {
  getItemOption,
  ITEM_OPTIONS,
  MAX_ITEMS,
  normalizeCustomLabel,
  resolveItemSelection,
} from "../server/item-options.mjs";
import {
  AI_BRIEFING_CACHE_TTL_MS,
  AI_BRIEFING_DAILY_LIMIT,
  generateAiBriefing,
  getBriefingState,
} from "../server/ai-briefing.mjs";
import {
  estimateCrowd,
  estimateCurrentCrowd,
  getCurrentCrowdIntelligence,
  normalizeCrowdResponse,
} from "../server/crowd-intelligence.mjs";
import {
  getKoreaDateKey,
  getOutingDateKey,
  isOutingToday,
  isPastOuting,
  normalizeStartsAt,
  parseDateInput,
} from "../server/kst-date.mjs";
import {
  apiError,
  asObject,
  assembleOutingSummaries,
  buildOutingBundle,
  buildOutingUpdate,
  canDeleteItem,
  cleanText,
  diffOutingChanges,
  enrichBundle,
  errorForException,
  etagMatches,
  formatOutingEtag,
  getCleanupCutoffs,
  identityRateBucket,
  mapMySessionRow,
  mapOutingRow,
  MAX_PARTICIPANTS,
  outingPlace,
  outingRateBucket,
  parseOutingInput,
  parseSummarySessions,
  pickClientIp,
  pickViewer,
  planItemUpdate,
  planRandomAssignments,
  RATE_LIMITS,
  rateLimitWindowStart,
  resolveAvatarKey,
  shouldLinkAnonymousUser,
} from "../server/outing-rules.mjs";
import { CLEANUP_SQL, SQL, SUMMARY_SQL } from "../server/outing-sql.mjs";
import {
  getCustomPlace,
  getPlace,
  PLACES,
  searchPlaces,
} from "../server/places.mjs";
import {
  ACTIVITY_TYPES,
  getActivityType,
  getSmartPackingRecommendations,
  normalizeExpectedPeople,
} from "../server/smart-packing.mjs";
import {
  generateSummerEvents,
  getSummerEventSearchState,
  SUMMER_EVENT_CACHE_TTL_MS,
  SUMMER_EVENT_DAILY_LIMIT,
} from "../server/summer-events.mjs";
import {
  getCachedWeatherStamp,
  getForecastWeather,
  getRegionalWeatherHighlights,
  getWeatherWindowStatus,
  isWeatherCacheFresh,
  resolveOutingWeather,
} from "../server/weather.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_WRITE_ATTEMPTS = 3;
const MEMORY_CACHE_LIMIT = 500;
const CACHE_ORIGIN = "https://cache.chaengyeosum.internal";
const CROWD_CACHE_TTL_MS = 5 * 60 * 1000;
const WEATHER_LOOKUP_TTL_MS = 30 * 60 * 1000;
const PLACE_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const OUTING_CACHE_CONTROL = "private, no-cache";

export class OpenAiEgress {
  async fetch(request) {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.origin !== "https://api.openai.com" ||
      url.pathname !== "/v1/responses"
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    return fetch(request);
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-headers":
      "authorization, content-type, if-none-match, x-chaengyeosum-user-key",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": origin || "*",
    "access-control-expose-headers": "etag",
    "cache-control": "no-store",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    vary: "Origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function json(request, status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(request, key, details) {
  const { status, body } = apiError(key, details);
  return json(request, status, body);
}

function waitUntil(ctx, promise) {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error("background_task_failed", error?.message ?? error);
  });
  if (ctx?.waitUntil) ctx.waitUntil(guarded);
  return guarded;
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function anonymousUserKey(request) {
  const value = request.headers.get("x-chaengyeosum-user-key") ?? "";
  return value.length <= 512 ? value : "";
}

function credentials(request) {
  return {
    token: bearerToken(request),
    anonymousUserKey: anonymousUserKey(request),
  };
}

function clientIp(request) {
  return pickClientIp({
    cfConnectingIp: request.headers.get("cf-connecting-ip"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    fallback: "",
  });
}

async function readBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error("body_too_large");
  }
  return raw ? JSON.parse(raw) : {};
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function randomInt(maxExclusive) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}

function opaqueId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// D1 helpers

function statement(db, sql, params = []) {
  return db.prepare(sql).bind(...params);
}

async function first(db, sql, params = []) {
  return statement(db, sql, params).first();
}

async function all(db, sql, params = []) {
  const result = await statement(db, sql, params).all();
  return result.results ?? [];
}

async function run(db, sql, params = []) {
  return statement(db, sql, params).run();
}

function changesOf(result) {
  return Number(result?.meta?.changes ?? 0);
}

function rowsOf(result) {
  return result?.results ?? [];
}

function eventStatement(
  db,
  outingId,
  participantId,
  eventType,
  itemLabel = null,
) {
  return statement(db, SQL.insertEvent, [
    opaqueId("evt"),
    outingId,
    participantId,
    eventType,
    itemLabel,
    new Date().toISOString(),
  ]);
}

function bumpStatement(db, outingId) {
  return statement(db, SQL.bumpRevision, [outingId]);
}

// ---------------------------------------------------------------------------
// Cache API + 격리 실행 환경 메모리 캐시
// (*.workers.dev에서는 Cache API가 동작하지 않을 수 있어 메모리 캐시를
// 함께 써요.)

const memoryCache = new Map();

function memoryCacheGet(key, now) {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    memoryCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function memoryCacheSet(key, value, expiresAt) {
  if (memoryCache.has(key)) memoryCache.delete(key);
  memoryCache.set(key, { value, expiresAt });
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

function defaultCache() {
  try {
    return globalThis.caches?.default ?? null;
  } catch {
    return null;
  }
}

async function cachedJson(
  ctx,
  key,
  ttlMs,
  produce,
  { shouldCache = () => true } = {},
) {
  const now = Date.now();
  const memoryHit = memoryCacheGet(key, now);
  if (memoryHit !== undefined) return { value: memoryHit, cached: true };

  const cache = defaultCache();
  const cacheKey = new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const payload = await hit.json();
        if (Number(payload?.expiresAt) > now) {
          memoryCacheSet(key, payload.value, Number(payload.expiresAt));
          return { value: payload.value, cached: true };
        }
      }
    } catch {
      // 캐시를 읽지 못하면 새로 만들어요.
    }
  }

  const value = await produce();
  if (shouldCache(value)) {
    const expiresAt = now + ttlMs;
    memoryCacheSet(key, value, expiresAt);
    if (cache) {
      waitUntil(
        ctx,
        cache.put(
          cacheKey,
          new Response(JSON.stringify({ value, expiresAt }), {
            headers: {
              "content-type": "application/json",
              "cache-control": `public, max-age=${Math.ceil(ttlMs / 1000)}`,
            },
          }),
        ),
      );
    }
  }
  return { value, cached: false };
}

// ---------------------------------------------------------------------------
// 권한 · 번들

async function resolveAccess(
  db,
  outingId,
  { token = "", anonymousUserKey: userKey = "", inviteCode = "" } = {},
) {
  const [tokenHashValue, anonymousHash] = await Promise.all([
    token ? tokenHash(token) : null,
    userKey ? tokenHash(userKey) : null,
  ]);
  const statements = [statement(db, SQL.outingAccess, [outingId])];
  if (tokenHashValue) {
    statements.push(
      statement(db, SQL.participantByToken, [tokenHashValue, outingId]),
    );
  }
  if (anonymousHash) {
    statements.push(
      statement(db, SQL.participantByAnonymous, [anonymousHash, outingId]),
    );
  }
  const results = await db.batch(statements);
  const outingRow = rowsOf(results[0])[0] ?? null;
  if (!outingRow) return { status: "not_found" };

  let index = 1;
  const tokenRow = tokenHashValue ? (rowsOf(results[index++])[0] ?? null) : null;
  const anonymousRow = anonymousHash
    ? (rowsOf(results[index++])[0] ?? null)
    : null;
  if (shouldLinkAnonymousUser(tokenRow, anonymousRow, anonymousHash)) {
    await run(db, SQL.linkAnonymousUser, [
      anonymousHash,
      tokenRow.id,
      outingId,
      anonymousHash,
    ]);
  }
  const viewer = pickViewer(tokenRow, anonymousRow);
  if (!viewer && (!inviteCode || outingRow.invite_code !== inviteCode)) {
    return { status: "forbidden", outingRow };
  }
  return {
    status: "ok",
    outingRow,
    viewer,
    isCreator: Boolean(viewer && viewer.id === outingRow.creator_id),
  };
}

async function requireParticipant(request, db, outingId) {
  const access = await resolveAccess(db, outingId, credentials(request));
  if (access.status === "not_found") {
    return { response: errorResponse(request, "not_found") };
  }
  if (access.status !== "ok" || !access.viewer) {
    return { response: errorResponse(request, "not_participant") };
  }
  return { access };
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

const refreshingWeather = new Set();

function weatherOptions(db, outing, outingRow, nowMs) {
  return {
    outing,
    readCache: () => weatherCacheFromRow(outingRow),
    writeCache: (payload, fetchedAt) =>
      run(db, SQL.putWeather, [
        outing.id,
        JSON.stringify(payload ?? null),
        fetchedAt,
      ]),
    now: nowMs,
  };
}

function scheduleWeatherRefresh(ctx, outingId, refresh) {
  if (!ctx?.waitUntil || refreshingWeather.has(outingId)) return;
  refreshingWeather.add(outingId);
  waitUntil(
    ctx,
    Promise.resolve()
      .then(refresh)
      .finally(() => refreshingWeather.delete(outingId)),
  );
}

function resolveWeather(db, ctx, outing, outingRow, nowMs) {
  return resolveOutingWeather({
    ...weatherOptions(db, outing, outingRow, nowMs),
    // 오래된 예보는 먼저 보여주고 뒤에서 새로 받아요(stale-while-revalidate).
    scheduleRefresh: ctx?.waitUntil
      ? (refresh) => scheduleWeatherRefresh(ctx, outing.id, refresh)
      : null,
  });
}

async function getBundleRows(db, outingId, viewerId) {
  const [participants, items, events, reactions] = await db.batch([
    statement(db, SQL.participants, [outingId]),
    statement(db, SQL.items, [outingId]),
    statement(db, SQL.recentEvents, [outingId]),
    statement(db, SQL.recentEventReactions, [viewerId ?? null, outingId]),
  ]);
  return {
    participantRows: rowsOf(participants),
    itemRows: rowsOf(items),
    eventRows: rowsOf(events),
    reactionRows: rowsOf(reactions),
  };
}

async function buildEnrichedBundle(db, ctx, access, nowMs = Date.now()) {
  const { outingRow, viewer } = access;
  const rows = await getBundleRows(db, outingRow.id, viewer?.id ?? null);
  const bundle = buildOutingBundle({
    outingRow,
    ...rows,
    viewer,
    now: nowMs,
  });
  const weatherInfo = await resolveWeather(
    db,
    ctx,
    bundle.outing,
    outingRow,
    nowMs,
  );
  return {
    bundle: enrichBundle(bundle, weatherInfo),
    etag: formatOutingEtag({
      revision: outingRow.revision,
      weatherStamp: weatherInfo.weatherStamp,
      viewerId: viewer?.id ?? null,
    }),
  };
}

async function loadEnrichedBundle(db, ctx, outingId, creds) {
  const access = await resolveAccess(db, outingId, creds);
  if (access.status !== "ok") return null;
  return buildEnrichedBundle(db, ctx, access);
}

// ---------------------------------------------------------------------------
// 사용량 제한

function identityLimit(config) {
  return {
    identity: config.bucket,
    limit: config.limit,
    error: "rate_limited",
  };
}

async function consumeLimits(request, db, entries) {
  const windowStart = rateLimitWindowStart(Date.now());
  const consumed = [];
  for (const entry of entries) {
    const bucket =
      entry.bucket ??
      (await identityRateBucket(entry.identity, {
        userKey: anonymousUserKey(request),
        ip: clientIp(request),
      }));
    const row = await first(db, SQL.consumeRateLimit, [
      bucket,
      windowStart,
      entry.limit,
    ]);
    if (!row) {
      if (consumed.length > 0) {
        await db.batch(
          consumed.map((previous) =>
            statement(db, SQL.releaseRateLimit, [previous, windowStart]),
          ),
        );
      }
      return entry.error;
    }
    consumed.push(bucket);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 모임

async function getOuting(request, db, ctx, outingId, url) {
  const access = await resolveAccess(db, outingId, {
    ...credentials(request),
    inviteCode: url.searchParams.get("invite") ?? "",
  });
  if (access.status === "not_found") {
    return errorResponse(request, "not_found");
  }
  if (access.status === "forbidden") {
    return errorResponse(request, "invite_required");
  }

  const nowMs = Date.now();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) {
    const outingRow = access.outingRow;
    const cached = weatherCacheFromRow(outingRow);
    const weatherStatus = getWeatherWindowStatus(outingRow.starts_at, nowMs);
    const weatherStamp = getCachedWeatherStamp({
      weatherStatus,
      cachePayload: cached?.payload ?? null,
      cacheFetchedAt: cached?.fetchedAt ?? null,
      now: nowMs,
      allowStale: true,
    });
    if (weatherStamp != null) {
      const etag = formatOutingEtag({
        revision: outingRow.revision,
        weatherStamp,
        viewerId: access.viewer?.id ?? null,
      });
      if (etagMatches(ifNoneMatch, etag)) {
        if (
          weatherStatus === "ok" &&
          cached &&
          !isWeatherCacheFresh(cached.payload, cached.fetchedAt, nowMs)
        ) {
          const outing = mapOutingRow(outingRow, nowMs);
          scheduleWeatherRefresh(ctx, outing.id, () =>
            resolveOutingWeather({
              ...weatherOptions(db, outing, { weather_fetched_at: null }, nowMs),
            }),
          );
        }
        return new Response(null, {
          status: 304,
          headers: {
            ...corsHeaders(request),
            etag,
            "cache-control": OUTING_CACHE_CONTROL,
          },
        });
      }
    }
  }

  const { bundle, etag } = await buildEnrichedBundle(db, ctx, access, nowMs);
  return json(request, 200, bundle, {
    etag,
    "cache-control": OUTING_CACHE_CONTROL,
  });
}

async function createOuting(request, db, ctx) {
  const body = asObject(await readBody(request));
  const parsed = parseOutingInput(body, { partial: false, now: Date.now() });
  if (parsed.error) return errorResponse(request, parsed.error);
  const items = resolveItemSelection(body.itemKeys, body.customItems);
  if (items.length === 0) return errorResponse(request, "no_items");

  const limited = await consumeLimits(request, db, [
    identityLimit(RATE_LIMITS.createOuting),
  ]);
  if (limited) return errorResponse(request, limited);

  const { values } = parsed;
  const outingId = opaqueId("out");
  const participantId = opaqueId("pt");
  const token = randomToken();
  const userKey = anonymousUserKey(request);
  const [hashedToken, anonymousUserHash] = await Promise.all([
    tokenHash(token),
    userKey ? tokenHash(userKey) : null,
  ]);
  const now = new Date().toISOString();
  const statements = [
    statement(db, SQL.insertOuting, [
      outingId,
      randomToken(7),
      values.title,
      values.place.id,
      values.place.name,
      values.place.latitude,
      values.place.longitude,
      values.startsAt,
      values.activityType,
      values.expectedPeople,
      now,
    ]),
    statement(db, SQL.insertParticipant, [
      participantId,
      outingId,
      values.creatorName,
      resolveAvatarKey(body.avatarKey, 0),
      hashedToken,
      anonymousUserHash,
      now,
    ]),
    ...items.map((item, index) =>
      statement(db, SQL.insertItem, [
        opaqueId("item"),
        outingId,
        item.key ?? opaqueId("custom"),
        item.label,
        item.visual,
        item.key === "water" || item.key === "snack" ? participantId : null,
        index,
      ]),
    ),
    eventStatement(db, outingId, participantId, "created"),
  ];
  await db.batch(statements);

  const loaded = await loadEnrichedBundle(db, ctx, outingId, {
    token,
    anonymousUserKey: userKey,
  });
  return json(request, 201, {
    session: { participantId, token },
    outing: loaded?.bundle ?? null,
  });
}

async function claimForJoin(db, outingId, participantId, item) {
  if (!item) return "none";
  if (item.owner_id == null) {
    const result = await run(db, SQL.assignIfUnowned, [
      participantId,
      item.id,
      outingId,
    ]);
    if (changesOf(result) > 0) {
      await db.batch([
        eventStatement(db, outingId, participantId, "claimed", item.label),
        bumpStatement(db, outingId),
      ]);
      return "claimed";
    }
  }
  const owner = await first(db, SQL.itemOwner, [item.id, outingId]);
  if (!owner) return "none";
  return owner.owner_id === participantId ? "claimed" : "taken";
}

async function joinOuting(request, db, ctx, outingId) {
  const body = asObject(await readBody(request));
  const name = cleanText(body.name, 10);
  const inviteCode = cleanText(body.inviteCode, 64);
  if (!name || !inviteCode) return errorResponse(request, "invalid_name");

  const limited = await consumeLimits(request, db, [
    identityLimit(RATE_LIMITS.joinOuting),
  ]);
  if (limited) return errorResponse(request, limited);

  const outing = await first(db, SQL.outingInvite, [outingId]);
  if (!outing || outing.invite_code !== inviteCode) {
    return errorResponse(request, "invalid_invite");
  }

  const claimItemId =
    typeof body.claimItemId === "string" && body.claimItemId.length <= 64
      ? body.claimItemId
      : "";
  const userKey = anonymousUserKey(request);
  const token = randomToken();
  const [hashedToken, anonymousUserHash] = await Promise.all([
    tokenHash(token),
    userKey ? tokenHash(userKey) : null,
  ]);

  const rotateExisting = async (existing) => {
    // 같은 토스 사용자가 다시 참여하면 기존 참여자에게 새 토큰을 줘요.
    const results = await db.batch([
      statement(db, SQL.rotateParticipantToken, [hashedToken, existing.id]),
      ...(claimItemId
        ? [statement(db, SQL.item, [claimItemId, outingId])]
        : []),
    ]);
    return {
      participantId: existing.id,
      created: false,
      claimItem: claimItemId ? (rowsOf(results[1])[0] ?? null) : null,
    };
  };

  let joined = null;
  const existing = anonymousUserHash
    ? await first(db, SQL.participantByAnonymous, [
        anonymousUserHash,
        outingId,
      ])
    : null;
  if (existing) {
    joined = await rotateExisting(existing);
  } else {
    const countRow = await first(db, SQL.participantCount, [outingId]);
    const count = Number(countRow?.count ?? 0);
    if (count >= MAX_PARTICIPANTS) {
      return errorResponse(request, "outing_full");
    }
    const participantId = opaqueId("pt");
    try {
      // 인원 확인·참여자 추가·이벤트·revision을 한 번에 원자적으로 처리해요.
      const results = await db.batch([
        statement(db, SQL.insertParticipantIfRoom, [
          participantId,
          outingId,
          name,
          resolveAvatarKey(body.avatarKey, count),
          hashedToken,
          anonymousUserHash,
          new Date().toISOString(),
          outingId,
        ]),
        statement(db, SQL.insertEventIfParticipant, [
          opaqueId("evt"),
          outingId,
          participantId,
          "joined",
          null,
          new Date().toISOString(),
          participantId,
        ]),
        statement(db, SQL.bumpRevisionIfParticipant, [
          outingId,
          participantId,
        ]),
        ...(claimItemId
          ? [statement(db, SQL.item, [claimItemId, outingId])]
          : []),
      ]);
      if (changesOf(results[0]) === 0) {
        return errorResponse(request, "outing_full");
      }
      joined = {
        participantId,
        created: true,
        claimItem: claimItemId ? (rowsOf(results[3])[0] ?? null) : null,
      };
    } catch (error) {
      // 같은 익명 사용자의 동시 참여는 UNIQUE 인덱스가 막아요.
      if (!anonymousUserHash || !/UNIQUE/i.test(String(error?.message))) {
        throw error;
      }
      const raced = await first(db, SQL.participantByAnonymous, [
        anonymousUserHash,
        outingId,
      ]);
      if (!raced) throw error;
      joined = await rotateExisting(raced);
    }
  }

  const claimResult = claimItemId
    ? await claimForJoin(db, outingId, joined.participantId, joined.claimItem)
    : "none";
  const loaded = await loadEnrichedBundle(db, ctx, outingId, {
    token,
    anonymousUserKey: userKey,
  });
  return json(request, joined.created ? 201 : 200, {
    session: { participantId: joined.participantId, token },
    outing: loaded?.bundle ?? null,
    claimResult,
  });
}

async function updateOuting(request, db, ctx, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  if (!access.isCreator) return errorResponse(request, "not_creator");
  const body = asObject(await readBody(request));
  const parsed = parseOutingInput(body, { partial: true, now: Date.now() });
  if (parsed.error) return errorResponse(request, parsed.error);

  const diff = diffOutingChanges(access.outingRow, parsed.values);
  if (diff.changed) {
    const update = buildOutingUpdate(outingId, diff.changes);
    await db.batch([
      statement(db, update.sql, update.params),
      eventStatement(db, outingId, access.viewer.id, "updated"),
      ...(diff.invalidatesWeather
        ? [statement(db, SQL.deleteWeather, [outingId])]
        : []),
    ]);
  }
  const loaded = await loadEnrichedBundle(
    db,
    ctx,
    outingId,
    credentials(request),
  );
  return json(request, 200, { outing: loaded?.bundle ?? null });
}

async function resetInviteCode(request, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  if (!access.isCreator) return errorResponse(request, "not_creator_invite");
  const inviteCode = randomToken(7);
  await run(db, SQL.resetInviteCode, [inviteCode, outingId]);
  return json(request, 200, { inviteCode });
}

async function deleteOuting(request, db, outingId) {
  const access = await resolveAccess(db, outingId, credentials(request));
  if (access.status === "not_found") {
    return errorResponse(request, "not_found");
  }
  if (access.status !== "ok" || !access.isCreator) {
    return errorResponse(request, "not_creator_delete");
  }
  const result = await run(db, SQL.deleteOuting, [outingId]);
  if (changesOf(result) === 0) return errorResponse(request, "not_found");
  return json(request, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// 준비물

async function updateItem(request, db, outingId, itemId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const body = asObject(await readBody(request));
  const requestedOwnerId =
    body.ownerId === null || typeof body.ownerId === "string"
      ? body.ownerId
      : undefined;
  const requestedDone = typeof body.done === "boolean" ? body.done : undefined;

  const [participantResult, firstItemResult] = await db.batch([
    statement(db, SQL.participants, [outingId]),
    statement(db, SQL.item, [itemId, outingId]),
  ]);
  const participantRows = rowsOf(participantResult);
  const participantIds = new Set(participantRows.map((row) => row.id));
  const nameOf = (participantId) =>
    participantRows.find((row) => row.id === participantId)?.name ?? "";

  let item = rowsOf(firstItemResult)[0] ?? null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) item = await first(db, SQL.item, [itemId, outingId]);
    if (!item) return errorResponse(request, "item_update_failed");
    const plan = planItemUpdate({
      item,
      viewerId: access.viewer.id,
      isCreator: access.isCreator,
      requestedOwnerId,
      requestedDone,
      participantIds,
    });
    if (plan.error === "already_claimed") {
      return errorResponse(request, plan.error, {
        ownerName: nameOf(plan.ownerId),
      });
    }
    if (plan.error) return errorResponse(request, plan.error);
    if (plan.noop) return json(request, 200, { ok: true });

    // 읽은 담당자·완료 상태가 그대로일 때만 바꿔 동시에 맡기를 막아요.
    const result = await run(db, SQL.updateItemIfUnchanged, [
      plan.ownerId,
      plan.done ? 1 : 0,
      itemId,
      outingId,
      item.owner_id ?? null,
      Number(item.done),
    ]);
    if (changesOf(result) > 0) {
      await db.batch([
        ...plan.events.map((event) =>
          eventStatement(
            db,
            outingId,
            event.participantId,
            event.type,
            item.label,
          ),
        ),
        bumpStatement(db, outingId),
      ]);
      return json(request, 200, { ok: true });
    }
  }
  const latest = await first(db, SQL.item, [itemId, outingId]);
  if (!latest) return errorResponse(request, "item_update_failed");
  return errorResponse(request, "already_claimed", {
    ownerName: nameOf(latest.owner_id),
  });
}

async function addItem(request, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const body = asObject(await readBody(request));
  const option =
    typeof body.optionKey === "string" ? getItemOption(body.optionKey) : null;
  const customLabel = normalizeCustomLabel(body.label);
  const item =
    option ??
    (customLabel
      ? { key: null, label: customLabel, visual: "asset:item-custom-3d.png" }
      : null);
  if (!item) return errorResponse(request, "invalid_item");

  // 중복·최대 개수 확인과 추가·이벤트·revision을 한 번에 처리해요.
  const itemId = opaqueId("item");
  const [inserted] = await db.batch([
    statement(db, SQL.insertItemIfAllowed, [
      itemId,
      outingId,
      item.key ?? opaqueId("custom"),
      item.label,
      item.visual,
      outingId,
      outingId,
      item.key ?? "",
      item.label,
      outingId,
    ]),
    statement(db, SQL.insertEventIfItem, [
      opaqueId("evt"),
      outingId,
      access.viewer.id,
      "item_added",
      item.label,
      new Date().toISOString(),
      itemId,
    ]),
    statement(db, SQL.bumpRevisionIfItem, [outingId, itemId]),
  ]);
  if (changesOf(inserted) === 0) {
    const countRow = await first(db, SQL.itemCount, [outingId]);
    return errorResponse(
      request,
      Number(countRow?.count ?? 0) >= MAX_ITEMS ? "max_items" : "duplicate_item",
    );
  }
  return json(request, 201, { ok: true, itemId });
}

async function deleteItem(request, db, outingId, itemId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const item = await first(db, SQL.item, [itemId, outingId]);
    if (!item) return errorResponse(request, "item_not_found");
    if (
      !canDeleteItem({
        item,
        viewerId: access.viewer.id,
        isCreator: access.isCreator,
      })
    ) {
      return errorResponse(request, "forbidden_delete");
    }
    // 마지막 준비물이 아니고 담당자가 그대로일 때만 지워요.
    const result = await run(db, SQL.deleteItemIfAllowed, [
      itemId,
      outingId,
      item.owner_id ?? null,
      outingId,
    ]);
    if (changesOf(result) > 0) {
      await db.batch([
        eventStatement(
          db,
          outingId,
          access.viewer.id,
          "item_deleted",
          item.label,
        ),
        bumpStatement(db, outingId),
      ]);
      return json(request, 200, { ok: true });
    }
    const countRow = await first(db, SQL.itemCount, [outingId]);
    if (Number(countRow?.count ?? 0) <= 1) {
      return errorResponse(request, "last_item");
    }
  }
  return errorResponse(request, "item_not_found");
}

async function completeMine(request, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const result = await run(db, SQL.completeMine, [outingId, access.viewer.id]);
  const completed = changesOf(result);
  if (completed > 0) {
    await db.batch([
      eventStatement(db, outingId, access.viewer.id, "completed_mine"),
      bumpStatement(db, outingId),
    ]);
  }
  return json(request, 200, { ok: true, completed });
}

async function randomizeItems(request, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const [participantResult, unassignedResult, ownerResult] = await db.batch([
    statement(db, SQL.participants, [outingId]),
    statement(db, SQL.unassignedItems, [outingId]),
    statement(db, SQL.ownerCounts, [outingId]),
  ]);
  const participantIds = rowsOf(participantResult).map((row) => row.id);
  const unassigned = rowsOf(unassignedResult);
  if (participantIds.length < 2) {
    return errorResponse(request, "need_participants");
  }
  if (unassigned.length === 0) {
    return errorResponse(request, "nothing_to_assign");
  }

  const assignments = planRandomAssignments({
    participantIds,
    unassignedItemIds: unassigned.map((row) => row.id),
    ownerCounts: rowsOf(ownerResult).map((row) => [
      row.owner_id,
      Number(row.count),
    ]),
    randomInt,
  });
  // 그사이 누군가 맡은 준비물은 건너뛰어요(owner_id IS NULL 조건).
  const results = await db.batch(
    assignments.map(({ itemId, ownerId }) =>
      statement(db, SQL.assignIfUnowned, [ownerId, itemId, outingId]),
    ),
  );
  const assigned = results.reduce(
    (sum, result) => sum + changesOf(result),
    0,
  );
  if (assigned === 0) return errorResponse(request, "nothing_to_assign");
  await db.batch([
    eventStatement(
      db,
      outingId,
      access.viewer.id,
      "randomized",
      String(assigned),
    ),
    bumpStatement(db, outingId),
  ]);
  return json(request, 200, { ok: true, assigned });
}

async function toggleReaction(request, db, outingId, eventId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const body = asObject(await readBody(request));
  if (!["heart", "cheer"].includes(body.reactionType)) {
    return errorResponse(request, "invalid_reaction");
  }
  const [eventResult, reactionResult] = await db.batch([
    statement(db, SQL.event, [eventId, outingId]),
    statement(db, SQL.reaction, [eventId, access.viewer.id]),
  ]);
  if (!rowsOf(eventResult)[0]) {
    return errorResponse(request, "event_not_found");
  }
  const existing = rowsOf(reactionResult)[0] ?? null;
  if (existing?.reaction_type === body.reactionType) {
    await db.batch([
      statement(db, SQL.deleteReaction, [eventId, access.viewer.id]),
      bumpStatement(db, outingId),
    ]);
    return json(request, 200, { ok: true, reaction: null });
  }
  await db.batch([
    statement(db, SQL.upsertReaction, [
      eventId,
      access.viewer.id,
      body.reactionType,
      new Date().toISOString(),
    ]),
    bumpStatement(db, outingId),
  ]);
  return json(request, 200, { ok: true, reaction: body.reactionType });
}

// ---------------------------------------------------------------------------
// 내 모임 · 요약

async function listMySessions(request, db) {
  const userKey = anonymousUserKey(request);
  if (!userKey) return errorResponse(request, "user_key_required");
  const now = Date.now();
  const today = getKoreaDateKey(now);
  const rows = await all(db, SQL.mySessions, [
    await tokenHash(userKey),
    today,
    today,
  ]);
  return json(request, 200, {
    sessions: rows.map((row) => mapMySessionRow(row, now)),
  });
}

async function getOutingSummaries(request, db) {
  const sessions = parseSummarySessions(await readBody(request));
  if (sessions.length === 0) return json(request, 200, { summaries: [] });

  const userKey = anonymousUserKey(request);
  const outingIds = sessions.map((session) => session.outingId);
  const [tokenHashes, anonymousHash] = await Promise.all([
    Promise.all(
      sessions.map((session) =>
        session.token ? tokenHash(session.token) : null,
      ),
    ),
    userKey ? tokenHash(userKey) : null,
  ]);
  const presentHashes = tokenHashes.filter(Boolean);

  const statements = [
    statement(db, SUMMARY_SQL.outings(outingIds.length), outingIds),
    statement(db, SUMMARY_SQL.items(outingIds.length), outingIds),
  ];
  if (presentHashes.length > 0) {
    statements.push(
      statement(
        db,
        SUMMARY_SQL.tokenParticipants(presentHashes.length),
        presentHashes,
      ),
    );
  }
  if (anonymousHash) {
    statements.push(
      statement(db, SUMMARY_SQL.anonymousParticipants(outingIds.length), [
        anonymousHash,
        ...outingIds,
      ]),
    );
  }
  const results = await db.batch(statements);
  let index = 2;
  const tokenRows = presentHashes.length > 0 ? rowsOf(results[index++]) : [];
  const anonymousRows = anonymousHash ? rowsOf(results[index++]) : [];

  const { summaries, links } = assembleOutingSummaries({
    sessions,
    tokenHashes,
    anonymousHash,
    tokenRows,
    anonymousRows,
    outingRows: rowsOf(results[0]),
    itemRows: rowsOf(results[1]),
    now: Date.now(),
  });
  if (links.length > 0) {
    await db.batch(
      links.map((link) =>
        statement(db, SQL.linkAnonymousUser, [
          anonymousHash,
          link.participantId,
          link.outingId,
          anonymousHash,
        ]),
      ),
    );
  }
  return json(request, 200, { summaries });
}

// ---------------------------------------------------------------------------
// AI · 장소 정보

function openAiFetch(env) {
  if (!env.AI_EGRESS) return fetch;
  return (url, options) => {
    const id = env.AI_EGRESS.idFromName("openai-us-egress-v1");
    const stub = env.AI_EGRESS.get(id, {
      locationHint: "enam",
    });
    return stub.fetch(new Request(url, options));
  };
}

async function getAiBriefing(request, env, db, ctx, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const nowMs = Date.now();
  if (isPastOuting(access.outingRow.starts_at, nowMs)) {
    return errorResponse(request, "outing_past");
  }
  if (!env.OPENAI_API_KEY) return errorResponse(request, "ai_unavailable");

  const { bundle } = await buildEnrichedBundle(db, ctx, access, nowMs);
  const { stateHash } = await getBriefingState(bundle);
  const cached = await first(
    db,
    `SELECT payload, model, created_at, expires_at
     FROM ai_briefings
     WHERE outing_id = ? AND state_hash = ? AND expires_at > ?`,
    [outingId, stateHash, nowMs],
  );
  if (cached) {
    try {
      return json(request, 200, {
        briefing: JSON.parse(cached.payload),
        meta: {
          cached: true,
          generatedAt: Number(cached.created_at),
          expiresAt: Number(cached.expires_at),
          model: cached.model,
          stateHash,
        },
      });
    } catch {
      await run(
        db,
        "DELETE FROM ai_briefings WHERE outing_id = ? AND state_hash = ?",
        [outingId, stateHash],
      );
    }
  }

  // OpenAI를 부르기 전에 사용량을 올려 실패한 시도도 집계해요.
  const limited = await consumeLimits(request, db, [
    {
      bucket: outingRateBucket(RATE_LIMITS.aiBriefing.bucket, outingId),
      limit: AI_BRIEFING_DAILY_LIMIT,
      error: "ai_daily_limit",
    },
    identityLimit(RATE_LIMITS.aiBriefing),
  ]);
  if (limited) return errorResponse(request, limited);

  try {
    const generated = await generateAiBriefing({
      bundle,
      apiKey: env.OPENAI_API_KEY,
      fetchImpl: openAiFetch(env),
    });
    const generatedAt = Date.now();
    const expiresAt = generatedAt + AI_BRIEFING_CACHE_TTL_MS;
    await db.batch([
      statement(
        db,
        `INSERT INTO ai_briefings (
           outing_id, state_hash, payload, model, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(outing_id, state_hash) DO UPDATE SET
           payload = excluded.payload,
           model = excluded.model,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
        [
          outingId,
          generated.stateHash,
          JSON.stringify(generated.briefing),
          generated.model,
          generatedAt,
          expiresAt,
        ],
      ),
      statement(
        db,
        "DELETE FROM ai_briefings WHERE outing_id = ? AND expires_at < ?",
        [outingId, nowMs],
      ),
    ]);
    console.log("ai_briefing_generated", {
      outingId,
      model: generated.model,
      cached: false,
      usage: generated.usage,
    });
    return json(request, 201, {
      briefing: generated.briefing,
      meta: {
        cached: false,
        generatedAt,
        expiresAt,
        model: generated.model,
        stateHash: generated.stateHash,
      },
    });
  } catch (error) {
    console.error("ai_briefing_generation_failed", {
      outingId,
      code: error?.message ?? "unknown",
      status: error?.status ?? null,
      apiCode: error?.apiCode ?? null,
      apiMessage: error?.apiMessage ?? null,
    });
    return errorResponse(request, "ai_failed");
  }
}

async function getCrowdForPlace(env, db, place, nowMs = Date.now()) {
  const cached = await first(
    db,
    `SELECT payload, expires_at
     FROM crowd_cache WHERE place_id = ? AND expires_at > ?`,
    [place.id, nowMs],
  );
  if (cached) {
    try {
      return {
        crowd: normalizeCrowdResponse(JSON.parse(cached.payload), {
          basis: "now",
          targetTime: nowMs,
          now: nowMs,
        }),
        meta: {
          cached: true,
          expiresAt: Number(cached.expires_at),
        },
      };
    } catch {
      await run(db, "DELETE FROM crowd_cache WHERE place_id = ?", [place.id]);
    }
  }

  const crowd = await getCurrentCrowdIntelligence({
    place,
    apiKey: env.SEOUL_OPEN_DATA_API_KEY ?? "",
    now: new Date(nowMs),
  });
  // 실시간 지원 장소에서 외부 API가 잠시 실패한 경우 예상값이 오래
  // 남지 않게 해 다음 조회에서 공식 데이터를 빠르게 다시 시도해요.
  const cacheTtlMs =
    crowd.mode === "estimate" && crowd.liveSupported
      ? 30 * 1000
      : CROWD_CACHE_TTL_MS;
  const expiresAt = nowMs + cacheTtlMs;
  await run(
    db,
    `INSERT INTO crowd_cache (place_id, payload, fetched_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
    [place.id, JSON.stringify(crowd), nowMs, expiresAt],
  );
  return {
    crowd: normalizeCrowdResponse(crowd, { basis: "now", now: nowMs }),
    meta: { cached: false, expiresAt },
  };
}

function startsAtMs(startsAt) {
  return parseDateInput(startsAt) ?? Date.parse(startsAt);
}

async function getPlaceIntelligence(request, env, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const nowMs = Date.now();
  const outing = mapOutingRow(access.outingRow, nowMs);
  const place = outingPlace(outing);
  if (!isOutingToday(outing.startsAt, nowMs)) {
    // 오늘이 아닌 모임은 모임 시각 기준으로 혼잡도를 예상해요.
    return json(request, 200, {
      crowd: estimateCrowd(place, {
        targetTime: new Date(startsAtMs(outing.startsAt)),
        basis: "outing",
        computedAt: new Date(nowMs),
      }),
      meta: { cached: false, expiresAt: nowMs + CROWD_CACHE_TTL_MS },
    });
  }
  return json(request, 200, await getCrowdForPlace(env, db, place, nowMs));
}

async function getSummerEvents(request, env, db, outingId) {
  const { access, response } = await requireParticipant(request, db, outingId);
  if (response) return response;
  const nowMs = Date.now();
  if (isPastOuting(access.outingRow.starts_at, nowMs)) {
    return errorResponse(request, "outing_past");
  }
  if (!env.OPENAI_API_KEY) return errorResponse(request, "events_unavailable");

  const outing = mapOutingRow(access.outingRow, nowMs);
  const place = outingPlace(outing);
  const { searchKey } = await getSummerEventSearchState({
    outing,
    place,
    now: new Date(nowMs),
  });
  const cached = await first(
    db,
    `SELECT payload, model, created_at, expires_at
     FROM summer_event_searches
     WHERE outing_id = ? AND search_key = ? AND expires_at > ?`,
    [outingId, searchKey, nowMs],
  );
  if (cached) {
    try {
      return json(request, 200, {
        events: JSON.parse(cached.payload),
        meta: {
          cached: true,
          generatedAt: Number(cached.created_at),
          expiresAt: Number(cached.expires_at),
          model: cached.model,
          searchKey,
        },
      });
    } catch {
      await run(
        db,
        "DELETE FROM summer_event_searches WHERE outing_id = ? AND search_key = ?",
        [outingId, searchKey],
      );
    }
  }

  const limited = await consumeLimits(request, db, [
    {
      bucket: outingRateBucket(RATE_LIMITS.summerEvents.bucket, outingId),
      limit: SUMMER_EVENT_DAILY_LIMIT,
      error: "events_daily_limit",
    },
    identityLimit(RATE_LIMITS.summerEvents),
  ]);
  if (limited) return errorResponse(request, limited);

  try {
    const generated = await generateSummerEvents({
      outing,
      place,
      apiKey: env.OPENAI_API_KEY,
      fetchImpl: openAiFetch(env),
      now: new Date(nowMs),
    });
    const generatedAt = Date.now();
    const expiresAt = generatedAt + SUMMER_EVENT_CACHE_TTL_MS;
    await db.batch([
      statement(
        db,
        `INSERT INTO summer_event_searches (
           outing_id, search_key, payload, model, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(outing_id, search_key) DO UPDATE SET
           payload = excluded.payload,
           model = excluded.model,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
        [
          outingId,
          generated.searchKey,
          JSON.stringify(generated.result),
          generated.model,
          generatedAt,
          expiresAt,
        ],
      ),
      statement(
        db,
        "DELETE FROM summer_event_searches WHERE outing_id = ? AND expires_at < ?",
        [outingId, nowMs],
      ),
    ]);
    console.log("summer_event_search_generated", {
      outingId,
      model: generated.model,
      cached: false,
      sourceCount: generated.sourceCount,
      usage: generated.usage,
    });
    return json(request, 201, {
      events: generated.result,
      meta: {
        cached: false,
        generatedAt,
        expiresAt,
        model: generated.model,
        searchKey: generated.searchKey,
        sourceCount: generated.sourceCount,
      },
    });
  } catch (error) {
    console.error("summer_event_search_failed", {
      outingId,
      code: error?.message ?? "unknown",
      status: error?.status ?? null,
      apiCode: error?.apiCode ?? null,
      apiMessage: error?.apiMessage ?? null,
    });
    return errorResponse(request, "events_failed");
  }
}

// ---------------------------------------------------------------------------
// 공개 정보(날씨·장소)

async function getWeatherHighlights(request, ctx) {
  const date = getKoreaDateKey();
  const { value, cached } = await cachedJson(
    ctx,
    `weather-highlights:${date}`,
    WEATHER_LOOKUP_TTL_MS,
    () => getRegionalWeatherHighlights(),
    { shouldCache: (result) => result.regions.length > 0 },
  );
  return json(request, 200, {
    regions: value.regions,
    meta: { ...value.meta, cached },
  });
}

async function getLocationWeather(request, ctx, url) {
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
    return errorResponse(request, "invalid_location");
  }
  const date = getKoreaDateKey();
  const roundedLatitude = latitude.toFixed(2);
  const roundedLongitude = longitude.toFixed(2);
  const { value: weather } = await cachedJson(
    ctx,
    `location-weather:${date}:${roundedLatitude}:${roundedLongitude}`,
    WEATHER_LOOKUP_TTL_MS,
    () =>
      getForecastWeather({
        id: `location-${roundedLatitude}-${roundedLongitude}`,
        startsAt: `${date}T12:00:00+09:00`,
        latitude: Number(roundedLatitude),
        longitude: Number(roundedLongitude),
      }),
    { shouldCache: (result) => result != null },
  );
  return json(request, 200, {
    weather,
    meta: { generatedAt: Date.now(), locationBased: true },
  });
}

async function getPlaceSearch(request, ctx, url) {
  const keyword = cleanText(url.searchParams.get("q"), 40);
  if (keyword.length < 2) return json(request, 200, { places: [] });
  const { value: places } = await cachedJson(
    ctx,
    `place-search:${keyword.toLowerCase()}`,
    PLACE_SEARCH_TTL_MS,
    () => searchPlaces(keyword),
    { shouldCache: (result) => result.length > 0 },
  );
  return json(request, 200, { places });
}

async function getPackingRecommendations(request, ctx, url) {
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
  if (!place || !startsAt) return errorResponse(request, "invalid_preview");

  let weatherStatus = getWeatherWindowStatus(startsAt, Date.now());
  let weather = null;
  if (weatherStatus === "ok") {
    const dateKey = getOutingDateKey(startsAt);
    ({ value: weather } = await cachedJson(
      ctx,
      `packing-weather:${place.id}:${dateKey}`,
      WEATHER_LOOKUP_TTL_MS,
      () =>
        getForecastWeather({
          id: "preview",
          startsAt,
          latitude: place.latitude,
          longitude: place.longitude,
        }),
      { shouldCache: (result) => result != null },
    ));
    weatherStatus = weather ? "ok" : "unavailable";
  }
  return json(request, 200, {
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

// ---------------------------------------------------------------------------
// 오래된 데이터 정리 (Cron Trigger)

export async function runCleanup(db, now = Date.now()) {
  const cutoffs = getCleanupCutoffs(now);
  let deletedOutings = 0;
  for (let round = 0; round < 25; round += 1) {
    const ids = (
      await all(db, CLEANUP_SQL.expiredOutingIds, [cutoffs.outingDateKey])
    ).map((row) => row.id);
    if (ids.length === 0) break;
    await db.batch(
      [
        ...CLEANUP_SQL.deleteAiForOutings(ids.length),
        ...CLEANUP_SQL.deleteForOutings(ids.length),
      ].map((sql) => statement(db, sql, ids)),
    );
    deletedOutings += ids.length;
  }
  await db.batch([
    statement(db, CLEANUP_SQL.deleteOldCrowdCache, [cutoffs.crowdFetchedBefore]),
    statement(db, CLEANUP_SQL.deleteExpiredAiBriefings, [now]),
    statement(db, CLEANUP_SQL.deleteExpiredSummerEvents, [now]),
    statement(db, CLEANUP_SQL.deleteOldRateLimits, [cutoffs.rateWindowBefore]),
  ]);
  console.log("cleanup_completed", { deletedOutings });
  return { deletedOutings };
}

// ---------------------------------------------------------------------------
// 라우팅

const OUTING_ROUTES = [
  [
    "GET",
    /^\/api\/outings\/([^/]+)$/,
    (c, id) => getOuting(c.request, c.db, c.ctx, id, c.url),
  ],
  [
    "PATCH",
    /^\/api\/outings\/([^/]+)$/,
    (c, id) => updateOuting(c.request, c.db, c.ctx, id),
  ],
  [
    "DELETE",
    /^\/api\/outings\/([^/]+)$/,
    (c, id) => deleteOuting(c.request, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/join$/,
    (c, id) => joinOuting(c.request, c.db, c.ctx, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/invite-code$/,
    (c, id) => resetInviteCode(c.request, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/ai-briefing$/,
    (c, id) => getAiBriefing(c.request, c.env, c.db, c.ctx, id),
  ],
  [
    "GET",
    /^\/api\/outings\/([^/]+)\/place-intelligence$/,
    (c, id) => getPlaceIntelligence(c.request, c.env, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/summer-events$/,
    (c, id) => getSummerEvents(c.request, c.env, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/items$/,
    (c, id) => addItem(c.request, c.db, id),
  ],
  [
    "PATCH",
    /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/,
    (c, id, itemId) => updateItem(c.request, c.db, id, itemId),
  ],
  [
    "DELETE",
    /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/,
    (c, id, itemId) => deleteItem(c.request, c.db, id, itemId),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/complete-mine$/,
    (c, id) => completeMine(c.request, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/randomize$/,
    (c, id) => randomizeItems(c.request, c.db, id),
  ],
  [
    "POST",
    /^\/api\/outings\/([^/]+)\/events\/([^/]+)\/reaction$/,
    (c, id, eventId) => toggleReaction(c.request, c.db, id, eventId),
  ],
];

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  if (!db) return errorResponse(request, "db_unavailable");

  if (request.method === "GET" && path === "/api/health") {
    const dbCheck = await first(db, "SELECT 1 AS ok");
    return json(request, 200, {
      ok: dbCheck?.ok === 1,
      service: "chaengyeosum-api",
      storage: "cloudflare-d1",
      features: [
        "regional-weather",
        "flexible-group-size",
        "outing-etag",
        "outing-edit",
        "outing-summaries",
      ],
    });
  }
  if (request.method === "GET" && path === "/api/places") {
    const now = new Date();
    return json(request, 200, {
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
        currentCrowd: estimateCurrentCrowd(place, now),
      })),
    });
  }
  if (request.method === "GET" && path === "/api/crowd-highlights") {
    const nowMs = Date.now();
    const places = await Promise.all(
      PLACES.filter((place) => place.seoulCrowdArea).map(async (place) => {
        const result = await getCrowdForPlace(env, db, place, nowMs);
        return {
          id: place.id,
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          city: place.city,
          currentCrowd: result.crowd,
        };
      }),
    );
    return json(request, 200, {
      places,
      meta: { generatedAt: nowMs },
    });
  }
  if (request.method === "GET" && path === "/api/weather-highlights") {
    return getWeatherHighlights(request, ctx);
  }
  if (request.method === "GET" && path === "/api/location-weather") {
    return getLocationWeather(request, ctx, url);
  }
  if (request.method === "GET" && path === "/api/place-search") {
    return getPlaceSearch(request, ctx, url);
  }
  if (request.method === "GET" && path === "/api/item-options") {
    return json(request, 200, {
      options: ITEM_OPTIONS,
      maxItems: MAX_ITEMS,
      activities: ACTIVITY_TYPES,
    });
  }
  if (
    request.method === "GET" &&
    path === "/api/packing-recommendations"
  ) {
    return getPackingRecommendations(request, ctx, url);
  }
  if (request.method === "POST" && path === "/api/outings") {
    return createOuting(request, db, ctx);
  }
  if (request.method === "GET" && path === "/api/me/outings") {
    return listMySessions(request, db);
  }
  if (request.method === "POST" && path === "/api/outing-summaries") {
    return getOutingSummaries(request, db);
  }

  const context = { request, env, db, ctx, url };
  for (const [method, pattern, handler] of OUTING_ROUTES) {
    if (request.method !== method) continue;
    const match = path.match(pattern);
    if (match) return handler(context, ...match.slice(1));
  }

  return errorResponse(request, "not_supported");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error("chaengyeosum_api_error", error);
      const { status, body } = errorForException(error);
      return json(request, status, body);
    }
  },

  async scheduled(controller, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(runCleanup(env.DB, Date.now()));
  },
};
