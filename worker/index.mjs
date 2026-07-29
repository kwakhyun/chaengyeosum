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
  estimateCurrentCrowd,
  getCurrentCrowdIntelligence,
} from "../server/crowd-intelligence.mjs";
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
  getSuggestedQuantity,
  normalizeExpectedPeople,
} from "../server/smart-packing.mjs";
import {
  generateSummerEvents,
  getSummerEventSearchState,
  SUMMER_EVENT_CACHE_TTL_MS,
  SUMMER_EVENT_DAILY_LIMIT,
} from "../server/summer-events.mjs";
import {
  getForecastWeather,
  getKoreaDateKey,
  WEATHER_REGIONS,
} from "../server/weather.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const AVATAR_KEYS = ["me", "minji", "junho", "seoyeon"];

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
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": origin || "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    vary: "Origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
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

async function first(db, sql, params = []) {
  return db
    .prepare(sql)
    .bind(...params)
    .first();
}

async function all(db, sql, params = []) {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all();
  return result.results ?? [];
}

function eventStatement(
  db,
  outingId,
  participantId,
  eventType,
  itemLabel = null,
) {
  return db
    .prepare(`
      INSERT INTO activity_events (
        id, outing_id, participant_id, event_type, item_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      opaqueId("evt"),
      outingId,
      participantId,
      eventType,
      itemLabel,
      new Date().toISOString(),
    );
}

function mapParticipant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    avatarKey: row.avatar_key,
    joinedAt: row.joined_at,
  };
}

function mapOuting(row) {
  if (!row) return null;
  return {
    id: row.id,
    inviteCode: row.invite_code,
    title: row.title,
    placeId: row.place_id,
    placeName: row.place_name,
    latitude: row.latitude,
    longitude: row.longitude,
    startsAt: row.starts_at,
    activityType: row.activity_type,
    expectedPeople: Number(row.expected_people ?? 2),
    createdAt: row.created_at,
  };
}

async function authorize(db, outingId, token) {
  if (!token) return null;
  const hash = await tokenHash(token);
  const participant = await first(
    db,
    `SELECT id, outing_id, name, avatar_key, joined_at
     FROM participants
     WHERE token_hash = ? AND outing_id = ?`,
    [hash, outingId],
  );
  return mapParticipant(participant);
}

async function getOutingBundle(
  db,
  outingId,
  { token, inviteCode } = {},
) {
  const outingRow = await first(
    db,
    "SELECT * FROM outings WHERE id = ?",
    [outingId],
  );
  if (!outingRow) return { status: "not_found" };

  const viewer = await authorize(db, outingId, token);
  if (!viewer && outingRow.invite_code !== inviteCode) {
    return { status: "forbidden" };
  }

  const [participantRows, itemRows, eventRows, reactionRows] =
    await Promise.all([
      all(
        db,
        `SELECT id, name, avatar_key, joined_at
         FROM participants WHERE outing_id = ? ORDER BY joined_at ASC`,
        [outingId],
      ),
      all(
        db,
        `SELECT id, item_key, label, image, owner_id, done, sort_order
         FROM checklist_items
         WHERE outing_id = ? ORDER BY sort_order ASC`,
        [outingId],
      ),
      all(
        db,
        `SELECT id, participant_id, event_type, item_label, created_at
         FROM activity_events
         WHERE outing_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 8`,
        [outingId],
      ),
      all(
        db,
        `SELECT event_id, participant_id, reaction_type
         FROM event_reactions
         WHERE event_id IN (
           SELECT id FROM activity_events WHERE outing_id = ?
         )`,
        [outingId],
      ),
    ]);

  const participants = participantRows.map(mapParticipant);
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const expectedPeople = Number(outingRow.expected_people ?? 2);
  const items = itemRows.map((row) => ({
    id: row.id,
    key: row.item_key,
    label: row.label,
    visual: row.image.includes(":") ? row.image : `asset:${row.image}`,
    owner: row.owner_id ? (participantById.get(row.owner_id) ?? null) : null,
    done: row.done === 1,
    sortOrder: row.sort_order,
    ...getSuggestedQuantity(row.item_key, expectedPeople),
  }));

  const reactionMap = new Map();
  for (const row of reactionRows) {
    const current = reactionMap.get(row.event_id) ?? {
      heart: 0,
      cheer: 0,
      viewerReaction: null,
    };
    if (row.reaction_type === "heart") current.heart += 1;
    if (row.reaction_type === "cheer") current.cheer += 1;
    if (viewer?.id === row.participant_id) {
      current.viewerReaction = row.reaction_type;
    }
    reactionMap.set(row.event_id, current);
  }

  const events = eventRows.map((row) => {
    const reactions = reactionMap.get(row.id) ?? {
      heart: 0,
      cheer: 0,
      viewerReaction: null,
    };
    return {
      id: row.id,
      type: row.event_type,
      itemLabel: row.item_label,
      createdAt: row.created_at,
      participant: row.participant_id
        ? (participantById.get(row.participant_id) ?? null)
        : null,
      reactions: {
        heart: reactions.heart,
        cheer: reactions.cheer,
      },
      viewerReaction: reactions.viewerReaction,
    };
  });

  return {
    status: "ok",
    outing: mapOuting(outingRow),
    participants,
    items,
    events,
    viewer,
  };
}

async function getOutingWeather(db, outing) {
  const cached = await first(
    db,
    "SELECT payload, fetched_at FROM weather_cache WHERE outing_id = ?",
    [outing.id],
  );
  if (cached && Date.now() - Number(cached.fetched_at) < WEATHER_CACHE_TTL_MS) {
    try {
      return JSON.parse(cached.payload);
    } catch {
      // Fetch a fresh forecast when cached JSON is corrupt.
    }
  }

  const weather = await getForecastWeather(outing);
  if (weather) {
    await db
      .prepare(`
        INSERT INTO weather_cache (outing_id, payload, fetched_at)
        VALUES (?, ?, ?)
        ON CONFLICT(outing_id) DO UPDATE SET
          payload = excluded.payload,
          fetched_at = excluded.fetched_at
      `)
      .bind(outing.id, JSON.stringify(weather), Date.now())
      .run();
    return weather;
  }

  try {
    return cached ? JSON.parse(cached.payload) : null;
  } catch {
    return null;
  }
}

async function getRegionalWeatherHighlights() {
  const date = getKoreaDateKey();
  const regions = await Promise.all(
    WEATHER_REGIONS.map(async (region) => ({
      ...region,
      weather: await getForecastWeather({
        id: `weather-${region.id}-${date}`,
        startsAt: `${date}T12:00:00+09:00`,
        latitude: region.latitude,
        longitude: region.longitude,
      }),
    })),
  );
  return {
    regions: regions.filter((region) => region.weather),
    meta: {
      generatedAt: Date.now(),
      date,
    },
  };
}

async function enrichBundle(db, bundle) {
  if (bundle.status !== "ok") return bundle;
  const weather = await getOutingWeather(db, bundle.outing);
  const place =
    getPlace(bundle.outing.placeId) ?? {
      id: bundle.outing.placeId,
      name: bundle.outing.placeName,
      latitude: bundle.outing.latitude,
      longitude: bundle.outing.longitude,
    };
  return {
    ...bundle,
    weather,
    smartRecommendations: getSmartPackingRecommendations({
      activityType: bundle.outing.activityType,
      place,
      weather,
      expectedPeople: bundle.outing.expectedPeople,
    }),
  };
}

function outingPlace(outing) {
  return (
    getPlace(outing.placeId) ?? {
      id: outing.placeId,
      name: outing.placeName,
      latitude: outing.latitude,
      longitude: outing.longitude,
      city: outing.placeName.split(",").at(-1)?.trim() || "대한민국",
      crowdBaseline: 45,
    }
  );
}

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

async function getAiBriefing(request, env, db, outingId) {
  const token = bearerToken(request);
  const bundle = await getOutingBundle(db, outingId, { token });
  if (bundle.status === "not_found") {
    return json(request, 404, { error: "모임을 찾지 못했어요." });
  }
  if (bundle.status !== "ok" || !bundle.viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  if (!env.OPENAI_API_KEY) {
    return json(request, 503, {
      error: "AI 브리핑을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
    });
  }

  const enriched = await enrichBundle(db, bundle);
  const { stateHash } = await getBriefingState(enriched);
  const now = Date.now();
  const cached = await first(
    db,
    `SELECT payload, model, created_at, expires_at
     FROM ai_briefings
     WHERE outing_id = ? AND state_hash = ? AND expires_at > ?`,
    [outingId, stateHash, now],
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
      await db
        .prepare(
          "DELETE FROM ai_briefings WHERE outing_id = ? AND state_hash = ?",
        )
        .bind(outingId, stateHash)
        .run();
    }
  }

  const recentUsage = await first(
    db,
    `SELECT COUNT(*) AS count
     FROM ai_briefings
     WHERE outing_id = ? AND created_at > ?`,
    [outingId, now - 24 * 60 * 60 * 1000],
  );
  if (Number(recentUsage?.count ?? 0) >= AI_BRIEFING_DAILY_LIMIT) {
    return json(request, 429, {
      error: "오늘 AI 브리핑을 충분히 만들었어요. 내일 다시 만나요.",
    });
  }

  try {
    const generated = await generateAiBriefing({
      bundle: enriched,
      apiKey: env.OPENAI_API_KEY,
      fetchImpl: openAiFetch(env),
    });
    const generatedAt = Date.now();
    const expiresAt = generatedAt + AI_BRIEFING_CACHE_TTL_MS;
    await db.batch([
      db
        .prepare(`
          INSERT INTO ai_briefings (
            outing_id, state_hash, payload, model, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(outing_id, state_hash) DO UPDATE SET
            payload = excluded.payload,
            model = excluded.model,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at
        `)
        .bind(
          outingId,
          generated.stateHash,
          JSON.stringify(generated.briefing),
          generated.model,
          generatedAt,
          expiresAt,
        ),
      db
        .prepare(
          "DELETE FROM ai_briefings WHERE outing_id = ? AND expires_at < ?",
        )
        .bind(outingId, now - 7 * 24 * 60 * 60 * 1000),
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
    return json(request, 502, {
      error: "AI 브리핑을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  }
}

async function getCrowdForPlace(env, db, place) {
  const now = Date.now();
  const cached = await first(
    db,
    `SELECT payload, expires_at
     FROM crowd_cache WHERE place_id = ? AND expires_at > ?`,
    [place.id, now],
  );
  if (cached) {
    try {
      return {
        crowd: JSON.parse(cached.payload),
        meta: {
          cached: true,
          expiresAt: Number(cached.expires_at),
        },
      };
    } catch {
      await db
        .prepare("DELETE FROM crowd_cache WHERE place_id = ?")
        .bind(place.id)
        .run();
    }
  }

  const crowd = await getCurrentCrowdIntelligence({
    place,
    apiKey: env.SEOUL_OPEN_DATA_API_KEY ?? "",
  });
  // 실시간 지원 장소에서 외부 API가 잠시 실패한 경우 예상값이 오래
  // 남지 않게 해 다음 조회에서 공식 데이터를 빠르게 다시 시도해요.
  const cacheTtlMs =
    crowd.mode === "estimate" && crowd.liveSupported
      ? 30 * 1000
      : 5 * 60 * 1000;
  const expiresAt = now + cacheTtlMs;
  await db
    .prepare(`
      INSERT INTO crowd_cache (place_id, payload, fetched_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(place_id) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `)
    .bind(place.id, JSON.stringify(crowd), now, expiresAt)
    .run();
  return {
    crowd,
    meta: { cached: false, expiresAt },
  };
}

async function getPlaceIntelligence(request, env, db, outingId) {
  const bundle = await getOutingBundle(db, outingId, {
    token: bearerToken(request),
  });
  if (bundle.status === "not_found") {
    return json(request, 404, { error: "모임을 찾지 못했어요." });
  }
  if (bundle.status !== "ok" || !bundle.viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }

  const place = outingPlace(bundle.outing);
  const result = await getCrowdForPlace(env, db, place);
  return json(request, 200, result);
}

async function getSummerEvents(request, env, db, outingId) {
  const bundle = await getOutingBundle(db, outingId, {
    token: bearerToken(request),
  });
  if (bundle.status === "not_found") {
    return json(request, 404, { error: "모임을 찾지 못했어요." });
  }
  if (bundle.status !== "ok" || !bundle.viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  if (!env.OPENAI_API_KEY) {
    return json(request, 503, {
      error: "AI 행사 검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
    });
  }

  const place = outingPlace(bundle.outing);
  const now = Date.now();
  const { searchKey } = await getSummerEventSearchState({
    outing: bundle.outing,
    place,
    now: new Date(now),
  });
  const cached = await first(
    db,
    `SELECT payload, model, created_at, expires_at
     FROM summer_event_searches
     WHERE outing_id = ? AND search_key = ? AND expires_at > ?`,
    [outingId, searchKey, now],
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
      await db
        .prepare(
          "DELETE FROM summer_event_searches WHERE outing_id = ? AND search_key = ?",
        )
        .bind(outingId, searchKey)
        .run();
    }
  }

  const recentUsage = await first(
    db,
    `SELECT COUNT(*) AS count
     FROM summer_event_searches
     WHERE outing_id = ? AND created_at > ?`,
    [outingId, now - 24 * 60 * 60 * 1000],
  );
  if (Number(recentUsage?.count ?? 0) >= SUMMER_EVENT_DAILY_LIMIT) {
    return json(request, 429, {
      error: "오늘 행사 검색을 충분히 했어요. 내일 다시 찾아볼게요.",
    });
  }

  try {
    const generated = await generateSummerEvents({
      outing: bundle.outing,
      place,
      apiKey: env.OPENAI_API_KEY,
      fetchImpl: openAiFetch(env),
      now: new Date(now),
    });
    const generatedAt = Date.now();
    const expiresAt = generatedAt + SUMMER_EVENT_CACHE_TTL_MS;
    await db.batch([
      db
        .prepare(`
          INSERT INTO summer_event_searches (
            outing_id, search_key, payload, model, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(outing_id, search_key) DO UPDATE SET
            payload = excluded.payload,
            model = excluded.model,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at
        `)
        .bind(
          outingId,
          generated.searchKey,
          JSON.stringify(generated.result),
          generated.model,
          generatedAt,
          expiresAt,
        ),
      db
        .prepare(
          "DELETE FROM summer_event_searches WHERE outing_id = ? AND expires_at < ?",
        )
        .bind(outingId, now - 7 * 24 * 60 * 60 * 1000),
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
    return json(request, 502, {
      error: "행사 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  }
}

async function createOuting(request, db) {
  const body = await readBody(request);
  const title = cleanText(body.title, 32);
  const creatorName = cleanText(body.creatorName, 10);
  const place = getPlace(body.placeId) ?? getCustomPlace(body.customPlace);
  const activityType = getActivityType(body.activityType);
  const expectedPeople = normalizeExpectedPeople(body.expectedPeople);
  if (
    title.length < 2 ||
    creatorName.length < 1 ||
    !place ||
    !validDate(body.startsAt)
  ) {
    return json(request, 400, {
      error: "모임 이름, 날짜, 장소, 닉네임을 확인해 주세요.",
    });
  }

  const items = resolveItemSelection(body.itemKeys, body.customItems);
  if (items.length === 0) {
    return json(request, 400, {
      error: "준비물을 한 개 이상 골라주세요.",
    });
  }

  const outingId = opaqueId("out");
  const participantId = opaqueId("pt");
  const token = randomToken();
  const inviteCode = randomToken(7);
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(`
        INSERT INTO outings (
          id, invite_code, title, place_id, place_name,
          latitude, longitude, starts_at, activity_type,
          expected_people, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        outingId,
        inviteCode,
        title,
        place.id,
        place.name,
        place.latitude,
        place.longitude,
        body.startsAt,
        activityType,
        expectedPeople,
        now,
      ),
    db
      .prepare(`
        INSERT INTO participants (
          id, outing_id, name, avatar_key, token_hash, joined_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        participantId,
        outingId,
        creatorName,
        "me",
        await tokenHash(token),
        now,
      ),
  ];

  items.forEach((item, index) => {
    statements.push(
      db
        .prepare(`
          INSERT INTO checklist_items (
            id, outing_id, item_key, label, image,
            owner_id, done, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `)
        .bind(
          opaqueId("item"),
          outingId,
          item.key ?? opaqueId("custom"),
          item.label,
          item.visual,
          item.key === "water" || item.key === "snack"
            ? participantId
            : null,
          index,
        ),
    );
  });
  statements.push(
    eventStatement(db, outingId, participantId, "created"),
  );
  await db.batch(statements);

  const bundle = await getOutingBundle(db, outingId, { token });
  return json(request, 201, {
    session: { participantId, token },
    outing: await enrichBundle(db, bundle),
  });
}

async function joinOuting(request, db, outingId) {
  const body = await readBody(request);
  const name = cleanText(body.name, 10);
  const inviteCode = cleanText(body.inviteCode, 64);
  if (!name || !inviteCode) {
    return json(request, 400, { error: "닉네임을 입력해 주세요." });
  }

  const outing = await first(
    db,
    "SELECT invite_code FROM outings WHERE id = ?",
    [outingId],
  );
  if (!outing || outing.invite_code !== inviteCode) {
    return json(request, 403, { error: "유효하지 않은 초대 링크예요." });
  }

  const countRow = await first(
    db,
    "SELECT COUNT(*) AS count FROM participants WHERE outing_id = ?",
    [outingId],
  );
  const participantId = opaqueId("pt");
  const token = randomToken();
  const now = new Date().toISOString();
  const avatarKey = AVATAR_KEYS[Number(countRow.count) % AVATAR_KEYS.length];
  await db.batch([
    db
      .prepare(`
        INSERT INTO participants (
          id, outing_id, name, avatar_key, token_hash, joined_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        participantId,
        outingId,
        name,
        avatarKey,
        await tokenHash(token),
        now,
      ),
    eventStatement(db, outingId, participantId, "joined"),
  ]);

  const bundle = await getOutingBundle(db, outingId, { token });
  return json(request, 201, {
    session: { participantId, token },
    outing: await enrichBundle(db, bundle),
  });
}

async function updateItem(request, db, outingId, itemId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const body = await readBody(request);
  const item = await first(
    db,
    "SELECT * FROM checklist_items WHERE id = ? AND outing_id = ?",
    [itemId, outingId],
  );
  if (!item) {
    return json(request, 404, { error: "준비물을 변경하지 못했어요." });
  }

  const statements = [];
  if (body.ownerId === null || typeof body.ownerId === "string") {
    if (body.ownerId !== null) {
      const owner = await first(
        db,
        "SELECT id FROM participants WHERE id = ? AND outing_id = ?",
        [body.ownerId, outingId],
      );
      if (!owner) {
        return json(request, 404, {
          error: "준비물을 변경하지 못했어요.",
        });
      }
    }
    statements.push(
      db
        .prepare(`
          UPDATE checklist_items SET owner_id = ?, done = 0
          WHERE id = ? AND outing_id = ?
        `)
        .bind(body.ownerId, itemId, outingId),
      eventStatement(
        db,
        outingId,
        body.ownerId ?? viewer.id,
        body.ownerId ? "claimed" : "unassigned",
        item.label,
      ),
    );
  }
  if (typeof body.done === "boolean") {
    statements.push(
      db
        .prepare(
          "UPDATE checklist_items SET done = ? WHERE id = ? AND outing_id = ?",
        )
        .bind(body.done ? 1 : 0, itemId, outingId),
      eventStatement(
        db,
        outingId,
        viewer.id,
        body.done ? "completed" : "reopened",
        item.label,
      ),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return json(request, 200, { ok: true });
}

async function addItem(request, db, outingId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const body = await readBody(request);
  const option =
    typeof body.optionKey === "string"
      ? getItemOption(body.optionKey)
      : null;
  const customLabel = normalizeCustomLabel(body.label);
  const item =
    option ??
    (customLabel
      ? {
          key: null,
          label: customLabel,
          visual: "asset:item-custom-3d.png",
        }
      : null);
  if (!item) {
    return json(request, 400, {
      error: "추가할 준비물을 확인해 주세요.",
    });
  }

  const [countRow, duplicate, orderRow] = await Promise.all([
    first(
      db,
      "SELECT COUNT(*) AS count FROM checklist_items WHERE outing_id = ?",
      [outingId],
    ),
    first(
      db,
      `SELECT id FROM checklist_items
       WHERE outing_id = ? AND (item_key = ? OR label = ?) LIMIT 1`,
      [outingId, item.key ?? "", item.label],
    ),
    first(
      db,
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM checklist_items WHERE outing_id = ?`,
      [outingId],
    ),
  ]);
  if (Number(countRow.count) >= MAX_ITEMS) {
    return json(request, 409, {
      error: `준비물은 최대 ${MAX_ITEMS}개까지 추가할 수 있어요.`,
    });
  }
  if (duplicate) {
    return json(request, 409, { error: "이미 목록에 있는 준비물이에요." });
  }

  const itemId = opaqueId("item");
  await db.batch([
    db
      .prepare(`
        INSERT INTO checklist_items (
          id, outing_id, item_key, label, image,
          owner_id, done, sort_order
        ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
      `)
      .bind(
        itemId,
        outingId,
        item.key ?? opaqueId("custom"),
        item.label,
        item.visual,
        Number(orderRow.next_order),
      ),
    eventStatement(db, outingId, viewer.id, "item_added", item.label),
  ]);
  return json(request, 201, { ok: true, itemId });
}

async function deleteItem(request, db, outingId, itemId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const [item, countRow] = await Promise.all([
    first(
      db,
      "SELECT label FROM checklist_items WHERE id = ? AND outing_id = ?",
      [itemId, outingId],
    ),
    first(
      db,
      "SELECT COUNT(*) AS count FROM checklist_items WHERE outing_id = ?",
      [outingId],
    ),
  ]);
  if (!item) {
    return json(request, 404, { error: "준비물을 찾지 못했어요." });
  }
  if (Number(countRow.count) <= 1) {
    return json(request, 409, {
      error: "준비물은 한 개 이상 남겨주세요.",
    });
  }
  await db.batch([
    db
      .prepare(
        "DELETE FROM checklist_items WHERE id = ? AND outing_id = ?",
      )
      .bind(itemId, outingId),
    eventStatement(db, outingId, viewer.id, "item_deleted", item.label),
  ]);
  return json(request, 200, { ok: true });
}

async function completeMine(request, db, outingId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const result = await db
    .prepare(`
      UPDATE checklist_items SET done = 1
      WHERE outing_id = ? AND owner_id = ? AND done = 0
    `)
    .bind(outingId, viewer.id)
    .run();
  const completed = Number(result.meta?.changes ?? 0);
  if (completed > 0) {
    await eventStatement(
      db,
      outingId,
      viewer.id,
      "completed_mine",
    ).run();
  }
  return json(request, 200, { ok: true, completed });
}

async function randomizeItems(request, db, outingId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const [participants, unassigned, ownerRows] = await Promise.all([
    all(
      db,
      "SELECT id FROM participants WHERE outing_id = ? ORDER BY joined_at",
      [outingId],
    ),
    all(
      db,
      `SELECT id FROM checklist_items
       WHERE outing_id = ? AND owner_id IS NULL ORDER BY sort_order`,
      [outingId],
    ),
    all(
      db,
      `SELECT owner_id, COUNT(*) AS count FROM checklist_items
       WHERE outing_id = ? AND owner_id IS NOT NULL GROUP BY owner_id`,
      [outingId],
    ),
  ]);
  if (participants.length < 2) {
    return json(request, 409, {
      error: "친구가 한 명 이상 참여한 뒤 뽑을 수 있어요.",
    });
  }
  if (unassigned.length === 0) {
    return json(request, 409, {
      error: "모든 준비물의 담당자가 정해졌어요.",
    });
  }

  const counts = new Map(
    ownerRows.map((row) => [row.owner_id, Number(row.count)]),
  );
  const shuffled = [...unassigned];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [
      shuffled[target],
      shuffled[index],
    ];
  }
  const statements = shuffled.map((item) => {
    const lowest = Math.min(
      ...participants.map(
        (participant) => counts.get(participant.id) ?? 0,
      ),
    );
    const candidates = participants.filter(
      (participant) => (counts.get(participant.id) ?? 0) === lowest,
    );
    const owner =
      candidates[Math.floor(Math.random() * candidates.length)];
    counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
    return db
      .prepare(
        "UPDATE checklist_items SET owner_id = ?, done = 0 WHERE id = ?",
      )
      .bind(owner.id, item.id);
  });
  statements.push(
    eventStatement(
      db,
      outingId,
      viewer.id,
      "randomized",
      String(shuffled.length),
    ),
  );
  await db.batch(statements);
  return json(request, 200, { ok: true, assigned: shuffled.length });
}

async function toggleReaction(request, db, outingId, eventId) {
  const viewer = await authorize(db, outingId, bearerToken(request));
  if (!viewer) {
    return json(request, 403, { error: "참여자 권한이 필요해요." });
  }
  const body = await readBody(request);
  if (!["heart", "cheer"].includes(body.reactionType)) {
    return json(request, 400, { error: "응원 종류를 확인해 주세요." });
  }
  const event = await first(
    db,
    "SELECT id FROM activity_events WHERE id = ? AND outing_id = ?",
    [eventId, outingId],
  );
  if (!event) {
    return json(request, 404, { error: "친구 소식을 찾지 못했어요." });
  }
  const existing = await first(
    db,
    `SELECT reaction_type FROM event_reactions
     WHERE event_id = ? AND participant_id = ?`,
    [eventId, viewer.id],
  );
  if (existing?.reaction_type === body.reactionType) {
    await db
      .prepare(
        "DELETE FROM event_reactions WHERE event_id = ? AND participant_id = ?",
      )
      .bind(eventId, viewer.id)
      .run();
    return json(request, 200, { ok: true, reaction: null });
  }
  await db
    .prepare(`
      INSERT INTO event_reactions (
        event_id, participant_id, reaction_type, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id, participant_id) DO UPDATE SET
        reaction_type = excluded.reaction_type,
        created_at = excluded.created_at
    `)
    .bind(
      eventId,
      viewer.id,
      body.reactionType,
      new Date().toISOString(),
    )
    .run();
  return json(request, 200, {
    ok: true,
    reaction: body.reactionType,
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  if (!db) {
    return json(request, 503, { error: "데이터베이스 연결이 필요해요." });
  }

  if (request.method === "GET" && path === "/api/health") {
    const dbCheck = await first(db, "SELECT 1 AS ok");
    return json(request, 200, {
      ok: dbCheck?.ok === 1,
      service: "chaengyeosum-api",
      storage: "cloudflare-d1",
      features: ["regional-weather", "flexible-group-size"],
    });
  }
  if (request.method === "GET" && path === "/api/places") {
    return json(request, 200, {
      places: PLACES.map((place) => ({
        id: place.id,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        city: place.city,
        currentCrowd: estimateCurrentCrowd(place),
      })),
    });
  }
  if (request.method === "GET" && path === "/api/crowd-highlights") {
    const places = await Promise.all(
      PLACES.filter((place) => place.seoulCrowdArea).map(async (place) => {
        const result = await getCrowdForPlace(env, db, place);
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
      meta: { generatedAt: Date.now() },
    });
  }
  if (request.method === "GET" && path === "/api/weather-highlights") {
    return json(
      request,
      200,
      await getRegionalWeatherHighlights(),
    );
  }
  if (request.method === "GET" && path === "/api/place-search") {
    return json(request, 200, {
      places: await searchPlaces(url.searchParams.get("q")),
    });
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
    const place =
      getPlace(url.searchParams.get("placeId")) ??
      getCustomPlace({
        name: url.searchParams.get("placeName"),
        latitude: url.searchParams.get("latitude"),
        longitude: url.searchParams.get("longitude"),
      });
    const startsAt = url.searchParams.get("startsAt");
    const activityType = getActivityType(
      url.searchParams.get("activityType"),
    );
    const expectedPeople = normalizeExpectedPeople(
      url.searchParams.get("expectedPeople"),
    );
    if (!place || !validDate(startsAt)) {
      return json(request, 400, {
        error: "활동, 날짜, 장소를 확인해 주세요.",
      });
    }
    const weather = await getForecastWeather({
      id: "preview",
      startsAt,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    return json(request, 200, {
      activityType,
      expectedPeople,
      weather,
      recommendations: getSmartPackingRecommendations({
        activityType,
        place,
        weather,
        expectedPeople,
      }),
    });
  }
  if (request.method === "POST" && path === "/api/outings") {
    return createOuting(request, db);
  }

  const outingMatch = path.match(/^\/api\/outings\/([^/]+)$/);
  if (request.method === "GET" && outingMatch) {
    const bundle = await getOutingBundle(db, outingMatch[1], {
      token: bearerToken(request),
      inviteCode: url.searchParams.get("invite") ?? "",
    });
    if (bundle.status === "not_found") {
      return json(request, 404, { error: "모임을 찾지 못했어요." });
    }
    if (bundle.status === "forbidden") {
      return json(request, 403, { error: "초대 링크가 필요해요." });
    }
    return json(request, 200, await enrichBundle(db, bundle));
  }

  const joinMatch = path.match(/^\/api\/outings\/([^/]+)\/join$/);
  if (request.method === "POST" && joinMatch) {
    return joinOuting(request, db, joinMatch[1]);
  }

  const aiBriefingMatch = path.match(
    /^\/api\/outings\/([^/]+)\/ai-briefing$/,
  );
  if (request.method === "POST" && aiBriefingMatch) {
    return getAiBriefing(request, env, db, aiBriefingMatch[1]);
  }

  const placeIntelligenceMatch = path.match(
    /^\/api\/outings\/([^/]+)\/place-intelligence$/,
  );
  if (request.method === "GET" && placeIntelligenceMatch) {
    return getPlaceIntelligence(
      request,
      env,
      db,
      placeIntelligenceMatch[1],
    );
  }

  const summerEventsMatch = path.match(
    /^\/api\/outings\/([^/]+)\/summer-events$/,
  );
  if (request.method === "POST" && summerEventsMatch) {
    return getSummerEvents(request, env, db, summerEventsMatch[1]);
  }

  const itemMatch = path.match(
    /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/,
  );
  if (request.method === "PATCH" && itemMatch) {
    return updateItem(request, db, itemMatch[1], itemMatch[2]);
  }
  if (request.method === "DELETE" && itemMatch) {
    return deleteItem(request, db, itemMatch[1], itemMatch[2]);
  }

  const itemsMatch = path.match(/^\/api\/outings\/([^/]+)\/items$/);
  if (request.method === "POST" && itemsMatch) {
    return addItem(request, db, itemsMatch[1]);
  }

  const completeMatch = path.match(
    /^\/api\/outings\/([^/]+)\/complete-mine$/,
  );
  if (request.method === "POST" && completeMatch) {
    return completeMine(request, db, completeMatch[1]);
  }

  const randomizeMatch = path.match(
    /^\/api\/outings\/([^/]+)\/randomize$/,
  );
  if (request.method === "POST" && randomizeMatch) {
    return randomizeItems(request, db, randomizeMatch[1]);
  }

  const reactionMatch = path.match(
    /^\/api\/outings\/([^/]+)\/events\/([^/]+)\/reaction$/,
  );
  if (request.method === "POST" && reactionMatch) {
    return toggleReaction(
      request,
      db,
      reactionMatch[1],
      reactionMatch[2],
    );
  }

  return json(request, 404, { error: "지원하지 않는 요청이에요." });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const isBodyTooLarge = error?.message === "body_too_large";
      const message =
        error instanceof SyntaxError
          ? "요청 데이터 형식이 올바르지 않아요."
          : "서버에서 처리하지 못했어요.";
      console.error("chaengyeosum_api_error", error);
      return json(request, isBodyTooLarge ? 413 : 500, {
        error: message,
      });
    }
  },
};
