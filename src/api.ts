import type {
  ActivityOption,
  AiBriefingResponse,
  OutingBundle,
  OutingSummary,
  ItemOption,
  OutingWeather,
  ParticipantSession,
  Place,
  PlaceIntelligenceResponse,
  RegionalWeather,
  SavedSession,
  SmartRecommendation,
  SummerEventResponse,
  WeatherStatus,
} from "./types";
import { getActiveAnonymousUserKey } from "./anonymous-user";

const DEFAULT_PRODUCTION_API =
  "https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/api";
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "/api" : DEFAULT_PRODUCTION_API)
).replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function apiFetch(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const anonymousUserKey = getActiveAnonymousUserKey();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(anonymousUserKey
        ? { "x-chaengyeosum-user-key": anonymousUserKey }
        : {}),
      ...options.headers,
    },
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error ??
        (response.status === 429
          ? "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
          : "요청을 처리하지 못했어요."),
      response.status,
      payload.code ?? "",
    );
  }
  return payload as T;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(path, options, token);
  } catch {
    throw new ApiError(
      "네트워크 연결을 확인해 주세요.",
      0,
      "network_error",
    );
  }
  return readJson<T>(response);
}

export function listMySessions() {
  return request<{ sessions: SavedSession[] }>("/me/outings");
}

export function listPlaces() {
  return request<{ places: Place[] }>("/places");
}

export function listCrowdHighlights() {
  return request<{
    places: Place[];
    meta: { generatedAt: number };
  }>("/crowd-highlights");
}

export function listWeatherHighlights() {
  return request<{
    regions: RegionalWeather[];
    meta: { generatedAt: number; date: string };
  }>("/weather-highlights");
}

export function getLocationWeather(latitude: number, longitude: number) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  });
  return request<{
    weather: OutingWeather | null;
    meta: { generatedAt: number; locationBased: true };
  }>(`/location-weather?${query}`);
}

export function searchPlaces(query: string) {
  return request<{ places: Place[] }>(
    `/place-search?q=${encodeURIComponent(query)}`,
  );
}

export function listItemOptions() {
  return request<{
    options: ItemOption[];
    maxItems: number;
    activities: ActivityOption[];
  }>("/item-options");
}

export function getPackingRecommendations(input: {
  activityType: string;
  placeId: string;
  customPlace?: Place;
  startsAt: string;
  expectedPeople: number;
}) {
  const query = new URLSearchParams({
    activityType: input.activityType,
    placeId: input.placeId,
    startsAt: input.startsAt,
    expectedPeople: String(input.expectedPeople),
    ...(input.customPlace
      ? {
          placeName: input.customPlace.name,
          latitude: String(input.customPlace.latitude),
          longitude: String(input.customPlace.longitude),
        }
      : {}),
  });
  return request<{
    activityType: string;
    weather: OutingWeather | null;
    weatherStatus?: WeatherStatus;
    recommendations: SmartRecommendation[];
  }>(`/packing-recommendations?${query}`);
}

export function createOuting(input: {
  title: string;
  placeId: string;
  startsAt: string;
  activityType: string;
  expectedPeople: number;
  creatorName: string;
  itemKeys: string[];
  customItems: string[];
  customPlace?: Place;
  avatarKey?: string;
}) {
  return request<{
    session: ParticipantSession;
    outing: OutingBundle;
  }>("/outings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getOuting(
  outingId: string,
  options: { token?: string; inviteCode?: string } = {},
) {
  const query = options.inviteCode
    ? `?invite=${encodeURIComponent(options.inviteCode)}`
    : "";
  return request<OutingBundle>(
    `/outings/${encodeURIComponent(outingId)}${query}`,
    {},
    options.token,
  );
}

// 새 서버는 x-chaengyeosum-etag를 허용해요. 배포 순서가 어긋나 예전 서버가
// 이 헤더를 막으면(CORS 실패) 이번 실행 동안은 If-None-Match로 돌아가요.
let customEtagHeaderBlocked = false;

/**
 * ETag를 보내 바뀐 내용이 없으면 본문 없이 304를 받아요.
 * 폴링 때 같은 모임 데이터를 반복해서 내려받지 않게 해요.
 */
export async function getOutingIfChanged(
  outingId: string,
  options: { token?: string; inviteCode?: string; etag?: string | null } = {},
): Promise<
  | { changed: false }
  | { changed: true; bundle: OutingBundle; etag: string | null }
> {
  const query = options.inviteCode
    ? `?invite=${encodeURIComponent(options.inviteCode)}`
    : "";
  const path = `/outings/${encodeURIComponent(outingId)}${query}`;
  // 버전은 조건부 헤더(If-None-Match)가 아닌 전용 헤더로 보내요. Chromium
  // WebView는 조건부 헤더가 있는 요청마다 CORS 사전 요청을 다시 보내요.
  const send = (headerName: string) =>
    apiFetch(
      path,
      { headers: options.etag ? { [headerName]: options.etag } : {} },
      options.token,
    );
  let response: Response;
  try {
    if (options.etag && !customEtagHeaderBlocked) {
      try {
        response = await send("x-chaengyeosum-etag");
      } catch {
        response = await send("if-none-match");
        customEtagHeaderBlocked = true;
      }
    } else {
      response = await send("if-none-match");
    }
  } catch {
    throw new ApiError(
      "네트워크 연결을 확인해 주세요.",
      0,
      "network_error",
    );
  }
  if (response.status === 304) return { changed: false };
  const etag = response.headers.get("etag");
  // 브라우저 캐시가 304를 받아 저장본을 200으로 돌려준 경우도 같은 버전이에요.
  if (response.ok && options.etag && etag === options.etag) {
    void response.body?.cancel().catch(() => {});
    return { changed: false };
  }
  const bundle = await readJson<OutingBundle>(response);
  return { changed: true, bundle, etag };
}

export function updateOuting(
  outingId: string,
  token: string,
  patch: {
    title?: string;
    startsAt?: string;
    placeId?: string;
    customPlace?: Place;
    activityType?: string;
    expectedPeople?: number;
  },
) {
  return request<{ outing: OutingBundle }>(
    `/outings/${encodeURIComponent(outingId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
    token,
  );
}

export function resetInviteCode(outingId: string, token: string) {
  return request<{ inviteCode: string }>(
    `/outings/${encodeURIComponent(outingId)}/invite-code`,
    { method: "POST" },
    token,
  );
}

export function getOutingSummaries(
  sessions: Array<{ outingId: string; token: string }>,
) {
  // missing: 서버에서 사라진(삭제·보관 기간 만료) 모임 ID예요. 예전 서버는 보내지 않아요.
  return request<{ summaries: OutingSummary[]; missing?: string[] }>(
    "/outing-summaries",
    {
      method: "POST",
      body: JSON.stringify({ sessions: sessions.slice(0, 30) }),
    },
  );
}

export function deleteOuting(outingId: string, token: string) {
  return request<{ ok: true }>(
    `/outings/${encodeURIComponent(outingId)}`,
    { method: "DELETE" },
    token,
  );
}

export function createAiBriefing(outingId: string, token: string) {
  return request<AiBriefingResponse>(
    `/outings/${encodeURIComponent(outingId)}/ai-briefing`,
    { method: "POST" },
    token,
  );
}

export function getPlaceIntelligence(outingId: string, token: string) {
  return request<PlaceIntelligenceResponse>(
    // basis=outing: 오늘이 아닌 모임은 모임 시간 기준 예상치를 받아요.
    // 예전 앱은 이 값을 보내지 않아 지금 기준 혼잡도를 그대로 받아요.
    `/outings/${encodeURIComponent(outingId)}/place-intelligence?basis=outing`,
    {},
    token,
  );
}

export function searchSummerEvents(outingId: string, token: string) {
  return request<SummerEventResponse>(
    `/outings/${encodeURIComponent(outingId)}/summer-events`,
    { method: "POST" },
    token,
  );
}

export function joinOuting(
  outingId: string,
  input: {
    inviteCode: string;
    name: string;
    avatarKey?: string;
    claimItemId?: string;
  },
) {
  return request<{
    session: ParticipantSession;
    outing: OutingBundle;
    claimResult?: "claimed" | "taken" | "none";
  }>(`/outings/${encodeURIComponent(outingId)}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateItem(
  outingId: string,
  itemId: string,
  token: string,
  patch: { done?: boolean; ownerId?: string | null },
) {
  return request<{ ok: true }>(
    `/outings/${encodeURIComponent(outingId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    token,
  );
}

export function addItem(
  outingId: string,
  token: string,
  input: { optionKey?: string; label?: string },
) {
  return request<{ ok: true; itemId: string }>(
    `/outings/${encodeURIComponent(outingId)}/items`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function deleteItem(
  outingId: string,
  itemId: string,
  token: string,
) {
  return request<{ ok: true }>(
    `/outings/${encodeURIComponent(outingId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
    token,
  );
}

export function completeMyItems(outingId: string, token: string) {
  return request<{ ok: true; completed: number }>(
    `/outings/${encodeURIComponent(outingId)}/complete-mine`,
    { method: "POST" },
    token,
  );
}

export function randomizeItems(outingId: string, token: string) {
  return request<{ ok: true; assigned: number }>(
    `/outings/${encodeURIComponent(outingId)}/randomize`,
    { method: "POST" },
    token,
  );
}

export function toggleEventReaction(
  outingId: string,
  eventId: string,
  token: string,
  reactionType: "heart" | "cheer",
) {
  return request<{
    ok: true;
    reaction: "heart" | "cheer" | null;
  }>(
    `/outings/${encodeURIComponent(outingId)}/events/${encodeURIComponent(eventId)}/reaction`,
    {
      method: "POST",
      body: JSON.stringify({ reactionType }),
    },
    token,
  );
}
