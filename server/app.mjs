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
  estimateCurrentCrowd,
  getCurrentCrowdIntelligence,
} from "./crowd-intelligence.mjs";
import {
  getItemOption,
  ITEM_OPTIONS,
  MAX_ITEMS,
  normalizeCustomLabel,
  resolveItemSelection,
} from "./item-options.mjs";
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
} from "./smart-packing.mjs";
import {
  generateSummerEvents,
  getSummerEventSearchState,
  SUMMER_EVENT_CACHE_TTL_MS,
  SUMMER_EVENT_DAILY_LIMIT,
  SUMMER_EVENT_MODEL,
} from "./summer-events.mjs";
import {
  getForecastWeather,
  getOutingWeather,
} from "./weather.mjs";

const MAX_BODY_BYTES = 32 * 1024;

function json(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function text(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function bearerToken(request) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
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

function validDate(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf());
}

export function createApiServer({
  dbFile,
  fetchImpl = fetch,
  weatherEnabled = true,
  openAiApiKey = process.env.OPENAI_API_KEY ?? "",
  aiModel = AI_BRIEFING_MODEL,
  eventModel = SUMMER_EVENT_MODEL,
  seoulOpenDataApiKey = process.env.SEOUL_OPEN_DATA_API_KEY ?? "",
}) {
  const store = createStore(dbFile);
  const aiBriefingCache = new Map();
  const aiBriefingUsage = new Map();
  const crowdCache = new Map();
  const summerEventCache = new Map();
  const summerEventUsage = new Map();

  async function enrichBundle(bundle) {
    if (bundle.status !== "ok") return bundle;
    const weather = weatherEnabled
      ? await getOutingWeather(store, bundle.outing, fetchImpl)
      : null;
    return {
      ...bundle,
      weather,
      smartRecommendations: getSmartPackingRecommendations({
        activityType: bundle.outing.activityType,
        place:
          getPlace(bundle.outing.placeId) ?? {
            id: bundle.outing.placeId,
            name: bundle.outing.placeName,
            latitude: bundle.outing.latitude,
            longitude: bundle.outing.longitude,
          },
        weather,
        expectedPeople: bundle.outing.expectedPeople,
      }),
    };
  }

  async function getAiBriefing(request, response, outingId) {
    const bundle = store.getOutingBundle(outingId, {
      token: bearerToken(request),
    });
    if (bundle.status === "not_found") {
      json(response, 404, { error: "모임을 찾지 못했어요." });
      return;
    }
    if (bundle.status !== "ok" || !bundle.viewer) {
      json(response, 403, { error: "참여자 권한이 필요해요." });
      return;
    }
    if (!openAiApiKey) {
      json(response, 503, {
        error: "AI 브리핑을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
      });
      return;
    }

    const enriched = await enrichBundle(bundle);
    const { stateHash } = await getBriefingState(enriched);
    const cacheKey = `${outingId}:${stateHash}`;
    const now = Date.now();
    const cached = aiBriefingCache.get(cacheKey);
    if (cached && cached.meta.expiresAt > now) {
      json(response, 200, {
        briefing: cached.briefing,
        meta: { ...cached.meta, cached: true },
      });
      return;
    }

    const usage = (aiBriefingUsage.get(outingId) ?? []).filter(
      (createdAt) => createdAt > now - 24 * 60 * 60 * 1000,
    );
    aiBriefingUsage.set(outingId, usage);
    if (usage.length >= AI_BRIEFING_DAILY_LIMIT) {
      json(response, 429, {
        error: "오늘 AI 브리핑을 충분히 만들었어요. 내일 다시 만나요.",
      });
      return;
    }

    try {
      const generated = await generateAiBriefing({
        bundle: enriched,
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
      aiBriefingUsage.set(outingId, [...usage, generatedAt]);
      json(response, 201, result);
    } catch (error) {
      console.error("ai_briefing_generation_failed", {
        outingId,
        code: error?.message ?? "unknown",
        status: error?.status ?? null,
        apiCode: error?.apiCode ?? null,
      });
      json(response, 502, {
        error:
          "AI 브리핑을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
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

  async function getPlaceIntelligence(request, response, outingId) {
    const bundle = store.getOutingBundle(outingId, {
      token: bearerToken(request),
    });
    if (bundle.status === "not_found") {
      json(response, 404, { error: "모임을 찾지 못했어요." });
      return;
    }
    if (bundle.status !== "ok" || !bundle.viewer) {
      json(response, 403, { error: "참여자 권한이 필요해요." });
      return;
    }

    const place = outingPlace(bundle.outing);
    const now = Date.now();
    const cached = crowdCache.get(place.id);
    if (cached && cached.expiresAt > now) {
      json(response, 200, {
        crowd: cached.crowd,
        meta: { cached: true, expiresAt: cached.expiresAt },
      });
      return;
    }

    const crowd = await getCurrentCrowdIntelligence({
      place,
      apiKey: seoulOpenDataApiKey,
      fetchImpl,
    });
    const cacheTtlMs =
      crowd.mode === "estimate" && crowd.liveSupported
        ? 30 * 1000
        : 5 * 60 * 1000;
    const expiresAt = now + cacheTtlMs;
    crowdCache.set(place.id, { crowd, expiresAt });
    json(response, 200, {
      crowd,
      meta: { cached: false, expiresAt },
    });
  }

  async function getSummerEvents(request, response, outingId) {
    const bundle = store.getOutingBundle(outingId, {
      token: bearerToken(request),
    });
    if (bundle.status === "not_found") {
      json(response, 404, { error: "모임을 찾지 못했어요." });
      return;
    }
    if (bundle.status !== "ok" || !bundle.viewer) {
      json(response, 403, { error: "참여자 권한이 필요해요." });
      return;
    }
    if (!openAiApiKey) {
      json(response, 503, {
        error: "AI 행사 검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
      });
      return;
    }

    const place = outingPlace(bundle.outing);
    const now = Date.now();
    const { searchKey } = await getSummerEventSearchState({
      outing: bundle.outing,
      place,
      now: new Date(now),
    });
    const cacheKey = `${outingId}:${searchKey}`;
    const cached = summerEventCache.get(cacheKey);
    if (cached && cached.meta.expiresAt > now) {
      json(response, 200, {
        events: cached.events,
        meta: { ...cached.meta, cached: true },
      });
      return;
    }

    const usage = (summerEventUsage.get(outingId) ?? []).filter(
      (createdAt) => createdAt > now - 24 * 60 * 60 * 1000,
    );
    summerEventUsage.set(outingId, usage);
    if (usage.length >= SUMMER_EVENT_DAILY_LIMIT) {
      json(response, 429, {
        error: "오늘 행사 검색을 충분히 했어요. 내일 다시 찾아볼게요.",
      });
      return;
    }

    try {
      const generated = await generateSummerEvents({
        outing: bundle.outing,
        place,
        apiKey: openAiApiKey,
        fetchImpl,
        model: eventModel,
        now: new Date(now),
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
      summerEventUsage.set(outingId, [...usage, generatedAt]);
      json(response, 201, result);
    } catch (error) {
      console.error("summer_event_search_failed", {
        outingId,
        code: error?.message ?? "unknown",
        status: error?.status ?? null,
        apiCode: error?.apiCode ?? null,
      });
      json(response, 502, {
        error: "행사 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
  }

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      json(response, 204, {});
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
        json(response, 200, {
          places: PLACES.map((place) => ({
            id: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            city: place.city,
            currentCrowd: estimateCurrentCrowd(place),
          })),
        });
        return;
      }

      if (request.method === "GET" && path === "/api/crowd-highlights") {
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
            }),
          })),
        );
        json(response, 200, {
          places,
          meta: { generatedAt: Date.now() },
        });
        return;
      }

      if (request.method === "GET" && path === "/api/place-search") {
        const places = await searchPlaces(
          url.searchParams.get("q"),
          fetchImpl,
        );
        json(response, 200, { places });
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
        const expectedPeople = Math.min(
          12,
          Math.max(
            1,
            Number(url.searchParams.get("expectedPeople")) || 2,
          ),
        );
        if (!place || !validDate(startsAt)) {
          json(response, 400, {
            error: "활동, 날짜, 장소를 확인해 주세요.",
          });
          return;
        }
        const previewOuting = {
          id: "preview",
          startsAt,
          latitude: place.latitude,
          longitude: place.longitude,
        };
        const weather = weatherEnabled
          ? await getForecastWeather(previewOuting, fetchImpl)
          : null;
        json(response, 200, {
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
        return;
      }

      if (request.method === "POST" && path === "/api/outings") {
        const body = await readBody(request);
        const title = text(body.title, 32);
        const creatorName = text(body.creatorName, 10);
        const place =
          getPlace(body.placeId) ?? getCustomPlace(body.customPlace);
        const activityType = getActivityType(body.activityType);
        const expectedPeople = Math.min(
          12,
          Math.max(1, Number(body.expectedPeople) || 2),
        );
        if (
          title.length < 2 ||
          creatorName.length < 1 ||
          !place ||
          !validDate(body.startsAt)
        ) {
          json(response, 400, {
            error: "모임 이름, 날짜, 장소, 닉네임을 확인해 주세요.",
          });
          return;
        }

        const items = resolveItemSelection(body.itemKeys, body.customItems);
        if (items.length === 0) {
          json(response, 400, {
            error: "준비물을 한 개 이상 골라주세요.",
          });
          return;
        }

        const created = store.createOuting({
          title,
          place,
          startsAt: body.startsAt,
          activityType,
          expectedPeople,
          creatorName,
          items,
        });
        const bundle = store.getOutingBundle(created.outingId, {
          token: created.session.token,
        });
        const enriched = await enrichBundle(bundle);

        json(response, 201, {
          session: created.session,
          outing: enriched.status === "ok" ? enriched : null,
        });
        return;
      }

      const outingMatch = path.match(/^\/api\/outings\/([^/]+)$/);
      if (request.method === "GET" && outingMatch) {
        const outingId = outingMatch[1];
        const bundle = store.getOutingBundle(outingId, {
          token: bearerToken(request),
          inviteCode: url.searchParams.get("invite") ?? "",
        });
        if (bundle.status === "not_found") {
          json(response, 404, { error: "모임을 찾지 못했어요." });
          return;
        }
        if (bundle.status === "forbidden") {
          json(response, 403, { error: "초대 링크가 필요해요." });
          return;
        }
        json(response, 200, await enrichBundle(bundle));
        return;
      }

      const joinMatch = path.match(/^\/api\/outings\/([^/]+)\/join$/);
      if (request.method === "POST" && joinMatch) {
        const body = await readBody(request);
        const name = text(body.name, 10);
        const inviteCode = text(body.inviteCode, 64);
        if (!name || !inviteCode) {
          json(response, 400, { error: "닉네임을 입력해 주세요." });
          return;
        }
        const session = store.joinOuting({
          outingId: joinMatch[1],
          inviteCode,
          name,
        });
        if (!session) {
          json(response, 403, { error: "유효하지 않은 초대 링크예요." });
          return;
        }
        const bundle = store.getOutingBundle(joinMatch[1], {
          token: session.token,
        });
        const enriched = await enrichBundle(bundle);
        json(response, 201, {
          session,
          outing: enriched.status === "ok" ? enriched : null,
        });
        return;
      }

      const aiBriefingMatch = path.match(
        /^\/api\/outings\/([^/]+)\/ai-briefing$/,
      );
      if (request.method === "POST" && aiBriefingMatch) {
        await getAiBriefing(request, response, aiBriefingMatch[1]);
        return;
      }

      const placeIntelligenceMatch = path.match(
        /^\/api\/outings\/([^/]+)\/place-intelligence$/,
      );
      if (request.method === "GET" && placeIntelligenceMatch) {
        await getPlaceIntelligence(
          request,
          response,
          placeIntelligenceMatch[1],
        );
        return;
      }

      const summerEventsMatch = path.match(
        /^\/api\/outings\/([^/]+)\/summer-events$/,
      );
      if (request.method === "POST" && summerEventsMatch) {
        await getSummerEvents(request, response, summerEventsMatch[1]);
        return;
      }

      const itemMatch = path.match(
        /^\/api\/outings\/([^/]+)\/items\/([^/]+)$/,
      );
      if (request.method === "PATCH" && itemMatch) {
        const body = await readBody(request);
        const result = store.updateItem({
          outingId: itemMatch[1],
          itemId: itemMatch[2],
          token: bearerToken(request),
          done: typeof body.done === "boolean" ? body.done : undefined,
          ownerId:
            body.ownerId === null || typeof body.ownerId === "string"
              ? body.ownerId
              : undefined,
        });
        if (result.status === "forbidden") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        if (result.status !== "ok") {
          json(response, 404, { error: "준비물을 변경하지 못했어요." });
          return;
        }
        json(response, 200, { ok: true });
        return;
      }

      const itemCollectionMatch = path.match(
        /^\/api\/outings\/([^/]+)\/items$/,
      );
      if (request.method === "POST" && itemCollectionMatch) {
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
                visual: "icon:custom",
              }
            : null);
        if (!item) {
          json(response, 400, { error: "추가할 준비물을 확인해 주세요." });
          return;
        }
        const result = store.addItem({
          outingId: itemCollectionMatch[1],
          token: bearerToken(request),
          item,
        });
        if (result.status === "forbidden") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        if (result.status === "duplicate") {
          json(response, 409, { error: "이미 목록에 있는 준비물이에요." });
          return;
        }
        if (result.status === "max_items") {
          json(response, 409, {
            error: `준비물은 최대 ${MAX_ITEMS}개까지 추가할 수 있어요.`,
          });
          return;
        }
        json(response, 201, { ok: true, itemId: result.itemId });
        return;
      }

      if (request.method === "DELETE" && itemMatch) {
        const result = store.deleteItem({
          outingId: itemMatch[1],
          itemId: itemMatch[2],
          token: bearerToken(request),
        });
        if (result.status === "forbidden") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        if (result.status === "last_item") {
          json(response, 409, {
            error: "준비물은 한 개 이상 남겨주세요.",
          });
          return;
        }
        if (result.status !== "ok") {
          json(response, 404, { error: "준비물을 찾지 못했어요." });
          return;
        }
        json(response, 200, { ok: true });
        return;
      }

      const completeMatch = path.match(
        /^\/api\/outings\/([^/]+)\/complete-mine$/,
      );
      if (request.method === "POST" && completeMatch) {
        const result = store.completeMyItems({
          outingId: completeMatch[1],
          token: bearerToken(request),
        });
        if (result.status !== "ok") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        json(response, 200, {
          ok: true,
          completed: result.completed,
        });
        return;
      }

      const randomizeMatch = path.match(
        /^\/api\/outings\/([^/]+)\/randomize$/,
      );
      if (request.method === "POST" && randomizeMatch) {
        const result = store.randomizeUnassigned({
          outingId: randomizeMatch[1],
          token: bearerToken(request),
        });
        if (result.status === "forbidden") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        if (result.status === "need_participants") {
          json(response, 409, {
            error: "친구가 한 명 이상 참여한 뒤 뽑을 수 있어요.",
          });
          return;
        }
        if (result.status === "nothing_to_assign") {
          json(response, 409, {
            error: "모든 준비물의 담당자가 정해졌어요.",
          });
          return;
        }
        json(response, 200, {
          ok: true,
          assigned: result.assigned,
        });
        return;
      }

      const reactionMatch = path.match(
        /^\/api\/outings\/([^/]+)\/events\/([^/]+)\/reaction$/,
      );
      if (request.method === "POST" && reactionMatch) {
        const body = await readBody(request);
        const result = store.toggleEventReaction({
          outingId: reactionMatch[1],
          eventId: reactionMatch[2],
          token: bearerToken(request),
          reactionType: body.reactionType,
        });
        if (result.status === "forbidden") {
          json(response, 403, { error: "참여자 권한이 필요해요." });
          return;
        }
        if (result.status === "invalid_reaction") {
          json(response, 400, { error: "응원 종류를 확인해 주세요." });
          return;
        }
        if (result.status !== "ok") {
          json(response, 404, { error: "친구 소식을 찾지 못했어요." });
          return;
        }
        json(response, 200, {
          ok: true,
          reaction: result.reaction,
        });
        return;
      }

      json(response, 404, { error: "지원하지 않는 요청이에요." });
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "요청 데이터 형식이 올바르지 않아요."
          : "서버에서 처리하지 못했어요.";
      json(response, error?.message === "body_too_large" ? 413 : 500, {
        error: message,
      });
    }
  });

  return {
    server,
    close() {
      store.close();
    },
  };
}
