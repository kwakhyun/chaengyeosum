// Node(SQLite) API와 Cloudflare Worker(D1)가 똑같이 동작하도록 공유하는
// 순수 규칙 모음이에요. DB 접근은 각 런타임이 하고, 판단·응답 모양은
// 여기서만 정해요.

import { MAX_ITEMS } from "./item-options.mjs";
import {
  DAY_MS,
  getKoreaDateKey,
  getKoreaDayStartMs,
  isPastOuting,
  isStartsAtInAllowedRange,
  normalizeStartsAt,
} from "./kst-date.mjs";
import { getCustomPlace, getPlace } from "./places.mjs";
import {
  DEFAULT_EXPECTED_PEOPLE,
  getActivityType,
  getQuantityPeople,
  getSmartPackingRecommendations,
  getSuggestedQuantity,
  normalizeExpectedPeople,
  parseCreateExpectedPeople,
  parseExpectedPeople,
} from "./smart-packing.mjs";

export const MAX_PARTICIPANTS = 30;
export const MAX_EVENTS = 30;
export const MAX_SUMMARY_SESSIONS = 30;
export const MAX_MY_OUTINGS = 30;
export const MAX_DAYS_AHEAD = 365;

export const AVATAR_KEYS = [
  "me",
  "minji",
  "junho",
  "seoyeon",
  "type-planner",
  "type-guardian",
  "type-vibe",
  "type-adventurer",
  "type-foodie",
  "type-navigator",
  "type-connector",
  "type-chill",
];
const AUTO_AVATAR_KEYS = ["me", "minji", "junho", "seoyeon"];

// limit은 사용자 키당, ipLimit은 IP당 하루 한도예요. 사용자 키는 클라이언트가
// 보내는 값이라 바꿔 가며 보낼 수 있어서 IP 한도를 항상 함께 적용해요.
// 통신사 NAT로 여러 사람이 같은 IP를 쓸 수 있어 IP 한도는 3배로 둬요.
export const RATE_LIMITS = {
  createOuting: { bucket: "create-outing", limit: 20, ipLimit: 60 },
  joinOuting: { bucket: "join-outing", limit: 60, ipLimit: 180 },
  aiBriefing: { bucket: "ai-briefing", limit: 20, ipLimit: 60 },
  summerEvents: { bucket: "summer-events", limit: 10, ipLimit: 30 },
};

// AI 브리핑과 행사 검색이 함께 쓰는 서비스 전체 하루 OpenAI 호출 한도예요.
// AI_GLOBAL_DAILY_LIMIT 환경 변수로 바꿀 수 있어요.
export const AI_GLOBAL_BUCKET = "openai-global";
export const DEFAULT_AI_GLOBAL_DAILY_LIMIT = 600;

export const RETENTION = {
  outingDays: 180,
  crowdCacheMs: 7 * DAY_MS,
  rateLimitMs: 3 * DAY_MS,
};

// ---------------------------------------------------------------------------
// 오류 응답: { error: "<한국어 문구>", code: "<snake_code>" }

const ERROR_DEFINITIONS = {
  not_supported: [404, "지원하지 않는 요청이에요."],
  server_error: [500, "서버에서 처리하지 못했어요."],
  invalid_json: [400, "요청 데이터 형식이 올바르지 않아요."],
  body_too_large: [413, "서버에서 처리하지 못했어요."],
  db_unavailable: [503, "데이터베이스 연결이 필요해요."],
  not_found: [404, "모임을 찾지 못했어요."],
  invite_required: [403, "초대 링크가 필요해요."],
  invalid_invite: [403, "유효하지 않은 초대 링크예요."],
  not_participant: [403, "참여자 권한이 필요해요."],
  not_creator: [403, "모임을 만든 사람만 수정할 수 있어요."],
  not_creator_delete: [403, "모임을 만든 사람만 삭제할 수 있어요.", "not_creator"],
  not_creator_invite: [
    403,
    "모임을 만든 사람만 초대 링크를 바꿀 수 있어요.",
    "not_creator",
  ],
  invalid_outing: [400, "모임 이름, 날짜, 장소, 닉네임을 확인해 주세요."],
  invalid_outing_update: [
    400,
    "모임 이름, 날짜, 장소를 확인해 주세요.",
    "invalid_outing",
  ],
  invalid_date: [400, "모임 날짜를 다시 확인해 주세요."],
  invalid_people: [400, "함께 갈 인원은 1명부터 50명까지 정할 수 있어요."],
  no_items: [400, "준비물을 한 개 이상 골라주세요."],
  invalid_name: [400, "닉네임을 입력해 주세요."],
  outing_full: [409, "모임 인원이 가득 찼어요."],
  user_key_required: [401, "토스 사용자 식별 정보가 필요해요."],
  invalid_location: [400, "위치 정보가 올바르지 않아요."],
  invalid_preview: [400, "활동, 날짜, 장소를 확인해 주세요.", "invalid_request"],
  item_not_found: [404, "준비물을 찾지 못했어요."],
  item_update_failed: [404, "준비물을 변경하지 못했어요.", "item_not_found"],
  invalid_owner: [400, "준비물을 변경하지 못했어요."],
  already_claimed: [
    409,
    ({ ownerName }) =>
      ownerName
        ? `이미 ${ownerName}님이 맡은 준비물이에요.`
        : "이미 다른 친구가 맡은 준비물이에요.",
  ],
  forbidden_owner: [
    403,
    "담당자나 모임을 만든 사람만 바꿀 수 있어요.",
    "forbidden",
  ],
  forbidden_done: [403, "담당자만 준비 상태를 바꿀 수 있어요.", "forbidden"],
  forbidden_delete: [
    403,
    "담당자나 모임을 만든 사람만 지울 수 있어요.",
    "forbidden",
  ],
  last_item: [409, "준비물은 하나 이상 있어야 해요."],
  invalid_item: [400, "추가할 준비물을 확인해 주세요."],
  duplicate_item: [409, "이미 목록에 있는 준비물이에요."],
  max_items: [409, `준비물은 최대 ${MAX_ITEMS}개까지 추가할 수 있어요.`],
  need_participants: [409, "친구가 한 명 이상 참여한 뒤 뽑을 수 있어요."],
  nothing_to_assign: [409, "모든 준비물의 담당자가 정해졌어요."],
  invalid_reaction: [400, "응원 종류를 확인해 주세요."],
  event_not_found: [404, "친구 소식을 찾지 못했어요."],
  outing_past: [409, "이미 지난 모임이에요."],
  rate_limited: [
    429,
    "오늘은 요청이 너무 많아요. 내일 다시 시도해 주세요.",
  ],
  ai_unavailable: [
    503,
    "AI 브리핑을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
  ],
  ai_daily_limit: [
    429,
    "오늘 AI 브리핑을 충분히 만들었어요. 내일 다시 만나요.",
    "daily_limit",
  ],
  ai_global_limit: [
    429,
    "오늘은 AI 브리핑 이용이 많아 마감됐어요. 내일 다시 시도해 주세요.",
    "daily_limit",
  ],
  ai_failed: [502, "AI 브리핑을 만들지 못했어요. 잠시 후 다시 시도해 주세요."],
  events_unavailable: [
    503,
    "AI 행사 검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
    "ai_unavailable",
  ],
  events_daily_limit: [
    429,
    "오늘 행사 검색을 충분히 했어요. 내일 다시 찾아볼게요.",
    "daily_limit",
  ],
  events_global_limit: [
    429,
    "오늘은 AI 행사 검색 이용이 많아 마감됐어요. 내일 다시 찾아볼게요.",
    "daily_limit",
  ],
  events_failed: [
    502,
    "행사 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    "ai_failed",
  ],
};

/** 오류 키를 { status, body: { error, code } }로 바꿔요. */
export function apiError(key, details = {}) {
  const [status, message, code] =
    ERROR_DEFINITIONS[key] ?? ERROR_DEFINITIONS.server_error;
  return {
    status,
    body: {
      error: typeof message === "function" ? message(details) : message,
      code: code ?? (ERROR_DEFINITIONS[key] ? key : "server_error"),
    },
  };
}

export function errorForException(error) {
  if (error?.message === "body_too_large") return apiError("body_too_large");
  if (error instanceof SyntaxError) return apiError("invalid_json");
  return apiError("server_error");
}

// ---------------------------------------------------------------------------
// 입력 검증

export function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function resolveAvatarKey(requested, participantCount) {
  return AVATAR_KEYS.includes(requested)
    ? requested
    : AUTO_AVATAR_KEYS[participantCount % AUTO_AVATAR_KEYS.length];
}

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * 모임 생성(partial=false)과 수정(partial=true)에 같은 검증을 써요.
 * 결과: { values } 또는 { error: <apiError 키> }
 */
export function parseOutingInput(
  rawBody,
  { partial = false, now = Date.now() } = {},
) {
  const body = asObject(rawBody);
  const invalid = partial ? "invalid_outing_update" : "invalid_outing";
  const values = {};

  if (!partial || has(body, "title")) {
    const title = cleanText(body.title, 32);
    if (title.length < 2) return { error: invalid };
    values.title = title;
  }
  if (!partial) {
    const creatorName = cleanText(body.creatorName, 10);
    if (creatorName.length < 1) return { error: invalid };
    values.creatorName = creatorName;
  }
  if (!partial || has(body, "placeId") || has(body, "customPlace")) {
    const place = getPlace(body.placeId) ?? getCustomPlace(body.customPlace);
    if (!place) return { error: invalid };
    values.place = place;
  }
  if (!partial || has(body, "startsAt")) {
    const startsAt = normalizeStartsAt(body.startsAt);
    if (
      !startsAt ||
      !isStartsAtInAllowedRange(startsAt, now, MAX_DAYS_AHEAD)
    ) {
      return { error: "invalid_date" };
    }
    values.startsAt = startsAt;
  }
  if (!partial || has(body, "activityType")) {
    values.activityType = getActivityType(body.activityType);
  }
  if (!partial || has(body, "expectedPeople")) {
    if (!partial && body.expectedPeople == null) {
      values.expectedPeople = DEFAULT_EXPECTED_PEOPLE;
    } else {
      // 생성은 이미 출시된 앱(최대 999명)과 호환되도록 50명 초과를 50명으로
      // 맞추고, 수정은 1~50명만 받아요.
      const expectedPeople = partial
        ? parseExpectedPeople(body.expectedPeople)
        : parseCreateExpectedPeople(body.expectedPeople);
      if (expectedPeople == null) return { error: "invalid_people" };
      values.expectedPeople = expectedPeople;
    }
  }
  if (partial && Object.keys(values).length === 0) {
    return { error: invalid };
  }
  return { values };
}

/** 수정 입력과 현재 행을 비교해 실제로 바뀌는 컬럼만 돌려줘요. */
export function diffOutingChanges(row, values) {
  const changes = {};
  if (values.title != null && values.title !== row.title) {
    changes.title = values.title;
  }
  if (
    values.place &&
    (values.place.id !== row.place_id ||
      values.place.name !== row.place_name ||
      Number(values.place.latitude) !== Number(row.latitude) ||
      Number(values.place.longitude) !== Number(row.longitude))
  ) {
    changes.place_id = values.place.id;
    changes.place_name = values.place.name;
    changes.latitude = values.place.latitude;
    changes.longitude = values.place.longitude;
  }
  if (values.startsAt != null && values.startsAt !== row.starts_at) {
    changes.starts_at = values.startsAt;
  }
  if (
    values.activityType != null &&
    values.activityType !== row.activity_type
  ) {
    changes.activity_type = values.activityType;
  }
  if (
    values.expectedPeople != null &&
    values.expectedPeople !== Number(row.expected_people)
  ) {
    changes.expected_people = values.expectedPeople;
  }
  return {
    changes,
    changed: Object.keys(changes).length > 0,
    invalidatesWeather: "starts_at" in changes || "place_id" in changes,
  };
}

const OUTING_UPDATE_COLUMNS = [
  "title",
  "place_id",
  "place_name",
  "latitude",
  "longitude",
  "starts_at",
  "activity_type",
  "expected_people",
];

/** 바뀐 컬럼만 쓰는 UPDATE 문이에요. revision도 함께 올려요. */
export function buildOutingUpdate(outingId, changes) {
  const columns = OUTING_UPDATE_COLUMNS.filter((column) => column in changes);
  return {
    sql: `UPDATE outings SET ${columns
      .map((column) => `${column} = ?`)
      .join(", ")}, revision = revision + 1 WHERE id = ?`,
    params: [...columns.map((column) => changes[column]), outingId],
  };
}

// ---------------------------------------------------------------------------
// 모임 번들

export function mapParticipantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    avatarKey: row.avatar_key,
    joinedAt: row.joined_at,
  };
}

export function mapOutingRow(row, now = Date.now()) {
  if (!row) return null;
  const place = getPlace(row.place_id);
  return {
    id: row.id,
    inviteCode: row.invite_code,
    title: row.title,
    placeId: row.place_id,
    placeName: row.place_name,
    placeCategory: place?.category ?? null,
    placeImageUrl: place?.imageUrl ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    startsAt: row.starts_at,
    activityType: row.activity_type,
    // 예전 서버가 저장한 50명 초과 값도 1~50명으로 맞춰 보여줘요.
    expectedPeople: normalizeExpectedPeople(row.expected_people),
    isPast: isPastOuting(row.starts_at, now),
    createdAt: row.created_at,
  };
}

export function mapItemVisual(image) {
  return image.includes(":") ? image : `asset:${image}`;
}

export function buildOutingBundle({
  outingRow,
  participantRows,
  itemRows,
  eventRows,
  reactionRows,
  viewer,
  now = Date.now(),
}) {
  const participants = participantRows.map(mapParticipantRow);
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const people = getQuantityPeople(
    outingRow.expected_people,
    participants.length,
  );
  const items = itemRows.map((row) => ({
    id: row.id,
    key: row.item_key,
    label: row.label,
    visual: mapItemVisual(row.image),
    owner: row.owner_id ? (participantById.get(row.owner_id) ?? null) : null,
    done: Number(row.done) === 1,
    sortOrder: row.sort_order,
    ...getSuggestedQuantity(row.item_key, people),
  }));
  const reactionsByEvent = new Map(
    reactionRows.map((row) => [row.event_id, row]),
  );
  const events = eventRows.map((row) => {
    const reactions = reactionsByEvent.get(row.id);
    return {
      id: row.id,
      type: row.event_type,
      itemLabel: row.item_label,
      createdAt: row.created_at,
      participant: row.participant_id
        ? (participantById.get(row.participant_id) ?? null)
        : null,
      reactions: {
        heart: Number(reactions?.heart ?? 0),
        cheer: Number(reactions?.cheer ?? 0),
      },
      viewerReaction: reactions?.viewer_reaction ?? null,
    };
  });
  const creatorId = outingRow.creator_id ?? participants[0]?.id ?? null;
  const isCreator = Boolean(viewer && creatorId === viewer.id);

  return {
    status: "ok",
    outing: mapOutingRow(outingRow, now),
    participants,
    items,
    events,
    viewer,
    isCreator,
    canDelete: isCreator,
    maxParticipants: MAX_PARTICIPANTS,
  };
}

/** 커스텀 장소까지 포함해 모임 장소 객체를 만들어요. */
export function outingPlace(outing) {
  return (
    getPlace(outing.placeId) ?? {
      id: outing.placeId,
      name: outing.placeName,
      latitude: outing.latitude,
      longitude: outing.longitude,
      city: outing.placeName.split(",").at(-1)?.trim() || "대한민국",
      crowdBaseline: 45,
      category: null,
    }
  );
}

export function enrichBundle(bundle, { weather, weatherStatus }) {
  return {
    ...bundle,
    weather,
    weatherStatus,
    smartRecommendations: getSmartPackingRecommendations({
      activityType: bundle.outing.activityType,
      place: outingPlace(bundle.outing),
      weather,
      expectedPeople: getQuantityPeople(
        bundle.outing.expectedPeople,
        bundle.participants.length,
      ),
    }),
  };
}

// ---------------------------------------------------------------------------
// 접근 권한

/** 토큰 참여자를 우선하고, 없으면 익명 사용자 키 참여자를 써요. */
export function pickViewer(tokenRow, anonymousRow) {
  return mapParticipantRow(tokenRow ?? anonymousRow ?? null);
}

/** 토큰 참여자에 아직 익명 키가 연결되지 않았을 때만 연결해요. */
export function shouldLinkAnonymousUser(tokenRow, anonymousRow, anonymousHash) {
  return Boolean(
    tokenRow &&
      anonymousHash &&
      tokenRow.anonymous_user_hash == null &&
      !anonymousRow,
  );
}

// ---------------------------------------------------------------------------
// ETag

export function formatOutingEtag({ revision, weatherStamp, viewerId }) {
  return `W/"${Number(revision ?? 0)}-${Number(weatherStamp ?? 0)}-${
    viewerId ?? "anon"
  }"`;
}

export function etagMatches(ifNoneMatch, etag) {
  if (typeof ifNoneMatch !== "string" || !ifNoneMatch) return false;
  const opaque = (value) => value.trim().replace(/^W\//i, "");
  const expected = opaque(etag);
  return ifNoneMatch
    .split(",")
    .some((candidate) => opaque(candidate) === expected);
}

// ---------------------------------------------------------------------------
// 준비물 권한

/**
 * 준비물 PATCH를 어떻게 반영할지 정해요.
 * 결과: { error, ownerId? } | { noop: true } | { ownerId, done, events }
 */
export function planItemUpdate({
  item,
  viewerId,
  isCreator,
  requestedOwnerId,
  requestedDone,
  participantIds,
}) {
  const currentOwner = item.owner_id ?? null;
  const currentDone = Number(item.done) === 1;
  let nextOwner = currentOwner;
  let nextDone = currentDone;
  const events = [];

  if (
    typeof requestedOwnerId !== "undefined" &&
    requestedOwnerId !== currentOwner
  ) {
    if (requestedOwnerId === null) {
      if (!(currentOwner === viewerId || isCreator)) {
        return { error: "forbidden_owner" };
      }
      events.push({ participantId: viewerId, type: "unassigned" });
    } else {
      if (!participantIds.has(requestedOwnerId)) {
        return { error: "invalid_owner" };
      }
      if (requestedOwnerId === viewerId) {
        if (!(currentOwner === null || isCreator)) {
          return { error: "already_claimed", ownerId: currentOwner };
        }
      } else if (
        !(isCreator || currentOwner === viewerId || currentOwner === null)
      ) {
        return { error: "forbidden_owner" };
      }
      events.push({ participantId: requestedOwnerId, type: "claimed" });
    }
    nextOwner = requestedOwnerId;
    nextDone = false;
  }

  if (typeof requestedDone === "boolean" && requestedDone !== nextDone) {
    if (!(nextOwner === null || nextOwner === viewerId || isCreator)) {
      return { error: "forbidden_done" };
    }
    nextDone = requestedDone;
    events.push({
      participantId: viewerId,
      type: requestedDone ? "completed" : "reopened",
    });
  }

  if (events.length === 0) return { noop: true };
  return { ownerId: nextOwner, done: nextDone, events };
}

export function canDeleteItem({ item, viewerId, isCreator }) {
  return item.owner_id == null || item.owner_id === viewerId || isCreator;
}

/** 담당자가 적은 사람부터 고르게 무작위 배정해요. */
export function planRandomAssignments({
  participantIds,
  unassignedItemIds,
  ownerCounts,
  randomInt,
}) {
  const counts = new Map(ownerCounts);
  const shuffled = [...unassignedItemIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled.map((itemId) => {
    const lowest = Math.min(
      ...participantIds.map((id) => counts.get(id) ?? 0),
    );
    const candidates = participantIds.filter(
      (id) => (counts.get(id) ?? 0) === lowest,
    );
    const ownerId = candidates[randomInt(candidates.length)];
    counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
    return { itemId, ownerId };
  });
}

// ---------------------------------------------------------------------------
// 내 모임 목록 · 요약

export function mapMySessionRow(row, now = Date.now()) {
  return {
    participantId: row.participant_id,
    token: "",
    outingId: row.outing_id,
    title: row.title,
    placeName: row.place_name,
    startsAt: row.starts_at,
    activityType: row.activity_type,
    isPast: isPastOuting(row.starts_at, now),
  };
}

export function parseSummarySessions(rawBody) {
  const body = asObject(rawBody);
  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  const seen = new Set();
  const result = [];
  for (const session of sessions.slice(0, MAX_SUMMARY_SESSIONS)) {
    const outingId =
      typeof session?.outingId === "string" ? session.outingId : "";
    const token = typeof session?.token === "string" ? session.token : "";
    if (!outingId || outingId.length > 64 || token.length > 512) continue;
    if (seen.has(outingId)) continue;
    seen.add(outingId);
    result.push({ outingId, token });
  }
  return result;
}

/**
 * 한 번에 읽은 행들로 요약을 조립해요.
 * 결과의 links는 익명 키를 연결해야 하는 참여자 목록이에요.
 */
export function assembleOutingSummaries({
  sessions,
  tokenHashes,
  anonymousHash,
  tokenRows,
  anonymousRows,
  outingRows,
  itemRows,
  now = Date.now(),
}) {
  const tokenRowByHash = new Map(tokenRows.map((row) => [row.token_hash, row]));
  const anonymousRowByOuting = new Map(
    anonymousRows.map((row) => [row.outing_id, row]),
  );
  const outingById = new Map(outingRows.map((row) => [row.id, row]));
  const itemsByOuting = new Map();
  for (const row of itemRows) {
    const list = itemsByOuting.get(row.outing_id) ?? [];
    list.push(row);
    itemsByOuting.set(row.outing_id, list);
  }

  const summaries = [];
  const links = [];
  // 모임 행이 아예 없는(삭제됐거나 보관 기간이 지난) 모임이에요.
  // 권한만 없는 모임은 넣지 않아요.
  const missing = [];
  sessions.forEach((session, index) => {
    const outing = outingById.get(session.outingId);
    if (!outing) {
      missing.push(session.outingId);
      return;
    }
    const hash = tokenHashes[index];
    const tokenRow = hash ? tokenRowByHash.get(hash) : null;
    const validTokenRow =
      tokenRow?.outing_id === session.outingId ? tokenRow : null;
    const anonymousRow = anonymousRowByOuting.get(session.outingId) ?? null;
    const viewerId = validTokenRow?.id ?? anonymousRow?.id ?? null;
    if (!viewerId) return;
    if (shouldLinkAnonymousUser(validTokenRow, anonymousRow, anonymousHash)) {
      links.push({ participantId: validTokenRow.id, outingId: outing.id });
    }

    let ready = 0;
    let unassigned = 0;
    let myOpen = 0;
    const items = itemsByOuting.get(outing.id) ?? [];
    for (const item of items) {
      const done = Number(item.done) === 1;
      if (done) ready += 1;
      if (item.owner_id == null) unassigned += 1;
      else if (item.owner_id === viewerId && !done) myOpen += 1;
    }
    summaries.push({
      outingId: outing.id,
      title: outing.title,
      placeName: outing.place_name,
      startsAt: outing.starts_at,
      ready,
      total: items.length,
      unassigned,
      myOpen,
      canDelete: outing.creator_id === viewerId,
      isPast: isPastOuting(outing.starts_at, now),
    });
  });
  return { summaries, links, missing };
}

// ---------------------------------------------------------------------------
// 사용량 제한

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const MAX_TRUSTED_PROXY_HOPS = 10;

/**
 * TRUST_PROXY 값을 읽어요.
 * - 없음·`0`·`false`: 프록시 헤더를 믿지 않아요(소켓 주소).
 * - `1`/`true`, `2`…: 앞단 프록시 수예요. X-Forwarded-For 오른쪽에서 센 값을 써요.
 * - `cloudflare`: Cloudflare가 넣는 CF-Connecting-IP를 써요.
 * 알 수 없는 값이면 null이에요(호출한 쪽이 끈 것으로 다뤄요).
 */
export function resolveTrustProxy(value) {
  if (value === true) return { mode: "hops", hops: 1 };
  if (value == null || value === false) return { mode: "off" };
  if (typeof value === "object" && value.mode) return value;
  const text = String(value).trim().toLowerCase();
  if (["", "0", "false", "off", "no"].includes(text)) return { mode: "off" };
  if (text === "true") return { mode: "hops", hops: 1 };
  if (text === "cloudflare") return { mode: "cloudflare" };
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS) {
      return { mode: "hops", hops };
    }
  }
  return null;
}

/**
 * 요청 한도에 쓸 클라이언트 IP를 골라요.
 * 클라이언트는 X-Forwarded-For 왼쪽 값과 CF-Connecting-IP를 마음대로 보낼 수
 * 있어요. 믿는 프록시는 자기가 본 주소를 오른쪽에 덧붙이므로 오른쪽에서
 * hops번째 값을 써요(항목이 그보다 적으면 가장 왼쪽 값). CF-Connecting-IP는
 * cloudflare 모드에서만 읽어요.
 */
export function pickClientIp({
  trustProxy,
  cfConnectingIp,
  forwardedFor,
  remoteAddress,
}) {
  const fallback =
    typeof remoteAddress === "string" && remoteAddress ? remoteAddress : "";
  const policy = resolveTrustProxy(trustProxy) ?? { mode: "off" };
  if (policy.mode === "cloudflare") {
    const cf = typeof cfConnectingIp === "string" ? cfConnectingIp.trim() : "";
    return cf || fallback;
  }
  if (policy.mode === "hops") {
    const hops =
      typeof forwardedFor === "string"
        ? forwardedFor
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
    if (hops.length === 0) return fallback;
    return hops[Math.max(0, hops.length - policy.hops)];
  }
  return fallback;
}

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_PATTERN = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

/** IPv6 주소를 16비트 8개로 펼쳐요. 형식이 틀리면 null이에요. */
function expandIpv6(value) {
  let text = value;
  const tail = [];
  const lastColon = text.lastIndexOf(":");
  if (lastColon >= 0 && text.includes(".", lastColon)) {
    // ::ffff:192.0.2.1 처럼 끝에 IPv4가 붙은 형식이에요.
    const ipv4 = text.slice(lastColon + 1);
    if (!IPV4_PATTERN.test(ipv4)) return null;
    const [a, b, c, d] = ipv4.split(".").map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, lastColon + 1);
    // "::"로 끝나지 않으면 앞 항목 뒤의 ':'만 남아요.
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const hextets = [...head, ...rest];
  if (!hextets.every((hextet) => /^[0-9a-f]{1,4}$/.test(hextet))) return null;
  const known = hextets.length + tail.length;
  if (halves.length === 2 ? known > 7 : known !== 8) return null;
  const zeros = Array(8 - known).fill(0);
  return [
    ...head.map((hextet) => parseInt(hextet, 16)),
    ...(halves.length === 2 ? zeros : []),
    ...rest.map((hextet) => parseInt(hextet, 16)),
    ...tail,
  ];
}

/**
 * IP 한도 버킷 키예요.
 * - IPv4는 주소 그대로예요(포트가 붙어 있으면 떼요).
 * - IPv4에 매핑된 IPv6(::ffff:a.b.c.d)는 IPv4로 봐요.
 * - IPv6는 /64(앞 16비트 4개)로 묶어요. 기기 한 대가 /64를 통째로 받는 일이
 *   흔해 주소를 바꿔 가며 한도를 피하지 못하게 해요.
 * - 알 수 없는 형식은 소문자로 바꿔 그대로 써요.
 */
export function rateLimitIpKey(value) {
  let ip = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ip) return "";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) {
    ip = bracketed[1];
  } else {
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
    if (withPort) ip = withPort[1];
  }
  const zone = ip.indexOf("%");
  if (zone > 0) ip = ip.slice(0, zone);
  if (IPV4_PATTERN.test(ip)) return ip;
  const hextets = ip.includes(":") ? expandIpv6(ip) : null;
  if (!hextets) return ip;
  const mappedIpv4 =
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;
  if (mappedIpv4) {
    const [high, low] = hextets.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((hextet) => hextet.toString(16))
    .join(":")}::/64`;
}

/**
 * 사람 기준 하루 한도 항목을 만들어요.
 * - IP를 알면 IP 버킷(ipLimit)을 항상 소비해요.
 * - 사용자 키가 있으면 사용자 키 버킷(limit)을 더해요.
 * - 사용자 키가 없으면 IP 버킷만 적용해요(같은 IP에서 키 있는 요청과 같은
 *   버킷·같은 한도라 키를 빼고 보내도 더 받을 수 없어요).
 * - 둘 다 모르면 공용 'unknown' IP 버킷을 써요.
 * - IP는 rateLimitIpKey로 맞춰요(IPv6는 /64 단위).
 * IP 버킷을 먼저 둬 키를 바꿔 가며 보내는 요청이 새 행을 만들기 전에 막아요.
 */
export async function identityRateLimits(config, { userKey, ip }) {
  const entries = [];
  const clientIp = rateLimitIpKey(ip) || (userKey ? "" : "unknown");
  if (clientIp) {
    entries.push({
      bucket: `${config.bucket}:${await sha256Hex(`ip:${clientIp}`)}`,
      limit: config.ipLimit ?? config.limit,
      error: "rate_limited",
    });
  }
  if (userKey) {
    entries.push({
      bucket: `${config.bucket}:${await sha256Hex(`user:${userKey}`)}`,
      limit: config.limit,
      error: "rate_limited",
    });
  }
  return entries;
}

/** 환경 변수 값을 1 이상 정수 한도로 읽어요. 아니면 기본값(600)이에요. */
export function resolveAiGlobalDailyLimit(value) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_AI_GLOBAL_DAILY_LIMIT;
}

/** AI 브리핑·행사 검색이 함께 쓰는 서비스 전체 OpenAI 한도 항목이에요. */
export function globalAiRateLimit(limit, error) {
  return {
    bucket: AI_GLOBAL_BUCKET,
    limit: resolveAiGlobalDailyLimit(limit),
    error,
  };
}

export function outingRateBucket(action, outingId) {
  return `${action}-outing:${outingId}`;
}

export function rateLimitWindowStart(now = Date.now()) {
  return getKoreaDayStartMs(now);
}

// ---------------------------------------------------------------------------
// 오래된 데이터 정리

export function getCleanupCutoffs(now = Date.now()) {
  return {
    outingDateKey: getKoreaDateKey(now - RETENTION.outingDays * DAY_MS),
    crowdFetchedBefore: now - RETENTION.crowdCacheMs,
    rateWindowBefore: now - RETENTION.rateLimitMs,
    now,
  };
}
