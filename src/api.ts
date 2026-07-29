import type {
  ActivityOption,
  AiBriefingResponse,
  OutingBundle,
  ItemOption,
  OutingWeather,
  ParticipantSession,
  Place,
  PlaceIntelligenceResponse,
  RegionalWeather,
  SmartRecommendation,
  SummerEventResponse,
} from "./types";

const DEFAULT_PRODUCTION_API =
  "https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/api";
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "/api" : DEFAULT_PRODUCTION_API)
).replace(/\/$/, "");

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "요청을 처리하지 못했어요.");
  }
  return payload as T;
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
  input: { inviteCode: string; name: string },
) {
  return request<{
    session: ParticipantSession;
    outing: OutingBundle;
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
