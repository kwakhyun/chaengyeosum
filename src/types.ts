export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  currentCrowd?: CrowdSignal;
}

export interface CrowdSignal {
  mode: "live" | "estimate";
  level: "relaxed" | "normal" | "busy" | "very_busy";
  label: string;
  score: number;
  summary: string;
  reasons: string[];
  populationRange: string | null;
  observedAt: string;
  source: {
    name: string;
    url: string | null;
    note: string;
  };
  liveSupported: boolean;
}

export interface PlaceIntelligenceResponse {
  crowd: CrowdSignal;
  meta: {
    cached: boolean;
    expiresAt: number;
  };
}

export interface SummerEvent {
  title: string;
  dateLabel: string;
  venue: string;
  why: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface SummerEventSearch {
  headline: string;
  searchSummary: string;
  events: SummerEvent[];
  noEventMessage: string;
}

export interface SummerEventResponse {
  events: SummerEventSearch;
  meta: {
    cached: boolean;
    generatedAt: number;
    expiresAt: number;
    model: string;
    searchKey: string;
    sourceCount?: number;
  };
}

export interface Participant {
  id: string;
  name: string;
  avatarKey: string;
  joinedAt: string;
}

export interface PackingItem {
  id: string;
  key: string;
  label: string;
  visual: string;
  owner: Participant | null;
  done: boolean;
  sortOrder: number;
  quantity: number;
  unit: string;
  quantityLabel: string;
}

export interface ItemOption {
  key: string;
  label: string;
  visual: string;
  recommended: boolean;
}

export interface ActivityOption {
  key: string;
  label: string;
  description: string;
}

export interface SmartRecommendation {
  key: string;
  label: string;
  visual: string;
  reason: string;
  quantity: number;
  unit: string;
  quantityLabel: string;
}

export interface Outing {
  id: string;
  inviteCode: string;
  title: string;
  placeId: string;
  placeName: string;
  latitude: number;
  longitude: number;
  startsAt: string;
  activityType: string;
  expectedPeople: number;
  createdAt: string;
}

export interface OutingWeather {
  date: string;
  maxTemperature: number;
  precipitationProbability: number;
  uvIndex: number;
  uvLabel: string;
  condition: string;
  source: string;
}

export interface OutingBundle {
  status: "ok";
  outing: Outing;
  participants: Participant[];
  items: PackingItem[];
  events: OutingEvent[];
  viewer: Participant | null;
  weather: OutingWeather | null;
  smartRecommendations: SmartRecommendation[];
}

export interface AiBriefingAction {
  kind: "assign" | "complete" | "weather" | "meetup";
  title: string;
  reason: string;
  targetItemKey: string | null;
}

export interface AiOutingBriefing {
  teamAlias: string;
  headline: string;
  verdict: string;
  actions: AiBriefingAction[];
  plotTwist: string;
  shareCaption: string;
}

export interface AiBriefingResponse {
  briefing: AiOutingBriefing;
  meta: {
    cached: boolean;
    generatedAt: number;
    expiresAt: number;
    model: string;
    stateHash: string;
  };
}

export interface OutingEvent {
  id: string;
  type:
    | "created"
    | "joined"
    | "claimed"
    | "unassigned"
    | "completed"
    | "reopened"
    | "completed_mine"
    | "item_added"
    | "item_deleted"
    | "randomized";
  itemLabel: string | null;
  createdAt: string;
  participant: Participant | null;
  reactions: {
    heart: number;
    cheer: number;
  };
  viewerReaction: "heart" | "cheer" | null;
}

export interface ParticipantSession {
  participantId: string;
  token: string;
}

export interface SavedSession extends ParticipantSession {
  outingId: string;
  title: string;
  placeName: string;
  startsAt: string;
  activityType?: string;
}
