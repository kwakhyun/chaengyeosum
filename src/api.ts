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
  let response: Response;
  try {
    response = await apiFetch(
      `/outings/${encodeURIComponent(outingId)}${query}`,
      {
        cache: "no-store",
        headers: options.etag ? { "if-none-match": options.etag } : {},
      },
      options.token,
    );
  } catch {
    throw new ApiError(
      "네트워크 연결을 확인해 주세요.",
      0,
      "network_error",
    );
  }
  if (response.status === 304) return { changed: false };
  const bundle = await readJson<OutingBundle>(response);
  return { changed: true, bundle, etag: response.headers.get("etag") };
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
  return request<{ summaries: OutingSummary[] }>("/outing-summaries", {
    method: "POST",
    body: JSON.stringify({ sessions: sessions.slice(0, 30) }),
  });
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
    `/outings/${encodeURIComponent(outingId)}/place-intelligence`,
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
