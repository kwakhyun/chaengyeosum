import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BackpackIcon,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  GlobeIcon,
  HomeIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReloadIcon,
  SunIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { closeView, graniteEvent } from "@apps-in-toss/web-framework";

import {
  createOuting,
  deleteOuting,
  getLocationWeather,
  getOuting,
  getOutingSummaries,
  getPackingRecommendations,
  listCrowdHighlights,
  listItemOptions,
  listMySessions,
  listPlaces,
  listWeatherHighlights,
  searchPlaces,
} from "./api";
import {
  initializeAnonymousUser,
  waitForAnonymousUser,
} from "./anonymous-user";
import { summerTypeAvatarKey } from "./avatars";
import { CrowdHighlightsCarousel } from "./components/CrowdHighlightsCarousel";
import { PlacePicker, waterActivityForCategory } from "./components/PlacePicker";
import { PopularSummerPlaces } from "./components/PopularSummerPlaces";
import { Sheet } from "./components/Sheet";
import {
  getSavedSummerType,
  isSummerTypeKey,
  SummerTypeTest,
  type SummerTypeKey,
  type SummerTypeResult,
} from "./components/SummerTypeTest";
import {
  SummerCrewBuilder,
  type OutingSuggestion,
} from "./components/SummerCrewBuilder";
import { WeatherHighlightsCarousel } from "./components/WeatherHighlightsCarousel";
import { OutingPage } from "./OutingPage";
import {
  APP_NAME,
  shareContent,
  track,
  type ShareOutcome,
} from "./platform";
import {
  getSavedSessions,
  mergeSessions,
  removeSession,
  replaceSessions,
  saveSession,
} from "./session";
import {
  addDaysToDateKey,
  daysUntil,
  formatDateKey,
  formatKoreaTime,
  formatOutingDate,
  isSummerSeason,
  todayDateKey,
} from "./time";
import {
  getSharedDisplayName,
  getTossUserDisplayName,
  normalizeUserDisplayName,
} from "./toss-user-profile";
import type {
  ActivityOption,
  CrowdSignal,
  ItemOption,
  OutingSummary,
  OutingWeather,
  Place,
  RegionalWeather,
  SavedSession,
  SmartRecommendation,
  WeatherStatus,
} from "./types";
import { activityIcon, errorMessage, ItemPicker } from "./ui";
import "./styles.css";

const APP_BACK_EVENT = "chaengyeosum:back";
const MAX_EXPECTED_PEOPLE = 50;

function crowdHeadline(crowd: CrowdSignal | null) {
  if (!crowd) return "혼잡도를 확인해요";
  if (crowd.level === "relaxed") return "여유로워요";
  if (crowd.level === "normal") return "무난해요";
  if (crowd.level === "busy") return "약간 붐벼요";
  return "많이 붐벼요";
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function currentOutingId() {
  return window.location.pathname.match(/^\/outing\/([^/]+)$/)?.[1] ?? null;
}

type HomeTab = "home" | "places" | "type" | "outings";
type CreateStep = 1 | 2 | 3 | 4;
type UserCoordinates = {
  latitude: number;
  longitude: number;
};

const HOME_PLACE_ORDER = [
  "yeouido-hangang",
  "caribbean-bay",
  "songjeong-beach",
  "baegun-valley",
  "seoul-forest",
  "ocean-world",
  "gimhae-lotte-waterpark",
];

function weatherRegionIdForPlace(place: Place | null) {
  if (!place) return "seoul";
  const location = `${place.city ?? ""} ${place.name}`;
  if (location.includes("부산") || location.includes("김해")) return "busan";
  if (location.includes("강원") || location.includes("홍천")) {
    return "gangneung";
  }
  if (location.includes("제주")) return "jeju";
  return "seoul";
}

function geoDistance(
  from: UserCoordinates,
  to: { latitude: number; longitude: number },
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getInitialHomeTab(sharedSummerType: SummerTypeKey | null): HomeTab {
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  if (
    requestedTab === "places" ||
    requestedTab === "type" ||
    requestedTab === "outings"
  ) {
    return requestedTab;
  }
  return sharedSummerType ? "type" : "home";
}

const CREATE_STEPS: Array<{
  key: CreateStep;
  label: string;
  description: string;
}> = [
  { key: 1, label: "기본", description: "어떤 모임인지 알려주세요." },
  { key: 2, label: "장소", description: "장소와 인원을 정해요." },
  { key: 3, label: "준비물", description: "함께 챙길 것을 골라요." },
  { key: 4, label: "확인", description: "마지막으로 확인해요." },
];

function sessionView(session: SavedSession, summary?: OutingSummary) {
  const startsAt = summary?.startsAt ?? session.startsAt;
  return {
    title: summary?.title ?? session.title,
    placeName: summary?.placeName ?? session.placeName,
    startsAt,
    isPast: summary?.isPast ?? daysUntil(startsAt) < 0,
  };
}

/** 다가오는 모임은 가까운 날짜순, 지난 모임은 최근순으로 나눠요. */
function splitSessions(
  sessions: SavedSession[],
  summaries: Map<string, OutingSummary>,
) {
  const withView = sessions.map((session) => ({
    session,
    view: sessionView(session, summaries.get(session.outingId)),
  }));
  const time = (value: string) => Date.parse(value) || 0;
  const upcoming = withView
    .filter((entry) => !entry.view.isPast)
    .sort((left, right) => time(left.view.startsAt) - time(right.view.startsAt))
    .map((entry) => entry.session);
  const past = withView
    .filter((entry) => entry.view.isPast)
    .sort((left, right) => time(right.view.startsAt) - time(left.view.startsAt))
    .map((entry) => entry.session);
  return { upcoming, past };
}

function OutingList({
  sessions,
  summaries,
  onOpenOuting,
  onDeleteOuting,
  deletingOutingId,
  onCreate,
  emptyTitle = "아직 모임이 없어요",
  emptyDescription = "첫 모임을 만들면 여기에 모아드려요.",
}: {
  sessions: SavedSession[];
  summaries: Map<string, OutingSummary>;
  onOpenOuting: (outingId: string) => void;
  onDeleteOuting?: (session: SavedSession) => void;
  deletingOutingId?: string | null;
  onCreate?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (sessions.length === 0) {
    return (
      <div className="empty-card">
        <CalendarIcon aria-hidden="true" />
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
        {onCreate ? (
          <button className="empty-card__action" type="button" onClick={onCreate}>
            <PlusIcon aria-hidden="true" />
            새 모임 만들기
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="outing-cards">
      {sessions.map((session) => {
        const summary = summaries.get(session.outingId);
        const view = sessionView(session, summary);
        const percent =
          summary && summary.total > 0
            ? Math.round((summary.ready / summary.total) * 100)
            : 0;
        return (
          <article
            className={`outing-card-row${onDeleteOuting ? " has-delete" : ""}${
              view.isPast ? " is-past" : ""
            }`}
            key={session.outingId}
          >
            <button
              className="outing-card"
              type="button"
              onClick={() => onOpenOuting(session.outingId)}
            >
              <span className="outing-card__icon">
                <CalendarIcon aria-hidden="true" />
              </span>
              <span className="outing-card__copy">
                <strong>{view.title}</strong>
                <span>
                  {formatOutingDate(view.startsAt)} · {view.placeName}
                </span>
                {summary ? (
                  <span className="outing-card__status">
                    <i aria-hidden="true">
                      <i style={{ width: `${percent}%` }} />
                    </i>
                    <b>
                      {summary.ready}/{summary.total} 준비
                      {!view.isPast && summary.myOpen > 0
                        ? ` · 내 할 일 ${summary.myOpen}개`
                        : !view.isPast && summary.unassigned > 0
                          ? ` · ${summary.unassigned}개 주인 찾는 중`
                          : ""}
                    </b>
                  </span>
                ) : null}
              </span>
              <ChevronRightIcon aria-hidden="true" />
            </button>
            {onDeleteOuting && summary?.canDelete ? (
              <button
                className="outing-card-delete"
                type="button"
                aria-label={`${view.title} 모임 삭제`}
                disabled={deletingOutingId === session.outingId}
                onClick={() => onDeleteOuting(session)}
              >
                <TrashIcon aria-hidden="true" />
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

/** 요약 API가 없는 예전 서버에서도 동작하도록 모임별 조회로 대신해요. */
async function loadOutingSummaries(
  sessions: SavedSession[],
): Promise<{ summaries: OutingSummary[]; missing: string[] }> {
  if (sessions.length === 0) return { summaries: [], missing: [] };
  try {
    const result = await getOutingSummaries(
      sessions.map((session) => ({
        outingId: session.outingId,
        token: session.token,
      })),
    );
    return { summaries: result.summaries, missing: result.missing ?? [] };
  } catch {
    const results = await Promise.allSettled(
      sessions.map(async (saved): Promise<OutingSummary> => {
        const bundle = await getOuting(saved.outingId, { token: saved.token });
        const viewerId = bundle.viewer?.id;
        return {
          outingId: saved.outingId,
          title: bundle.outing.title,
          placeName: bundle.outing.placeName,
          startsAt: bundle.outing.startsAt,
          ready: bundle.items.filter((item) => item.done).length,
          total: bundle.items.length,
          unassigned: bundle.items.filter((item) => item.owner == null).length,
          myOpen: bundle.items.filter(
            (item) => item.owner?.id === viewerId && !item.done,
          ).length,
          canDelete: bundle.canDelete,
          isPast: bundle.outing.isPast ?? daysUntil(bundle.outing.startsAt) < 0,
        };
      }),
    );
    return {
      summaries: results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
      missing: [],
    };
  }
}

function sameSessionList(left: SavedSession[], right: SavedSession[]) {
  return (
    left.length === right.length &&
    left.every(
      (session, index) =>
        session.outingId === right[index].outingId &&
        session.token === right[index].token,
    )
  );
}

// 로컬 참여 토큰을 토스 익명 사용자와 연결하는 일은 앱 실행마다 한 번이면 충분해요.
// 진행 중인 연결은 공유해서, 그사이 홈 화면이 다시 열려도 결과를 함께 받아요.
let sessionLink: { key: string; promise: Promise<void> } | null = null;

function linkAnonymousSessions(anonymousUser: {
  key: string;
  canLinkLocalSessions: boolean;
}) {
  if (sessionLink?.key === anonymousUser.key) return sessionLink.promise;
  const localSessions = anonymousUser.canLinkLocalSessions
    ? getSavedSessions()
    : [];
  // 요약 조회가 로컬 참여 토큰을 토스 익명 사용자와 연결해요.
  const promise = loadOutingSummaries(localSessions)
    .then(() => listMySessions())
    .then((result) => {
      // 복구한 목록은 저장소에 먼저 남겨, 화면이 바뀌어도 잃지 않아요.
      if (anonymousUser.canLinkLocalSessions) mergeSessions(result.sessions);
      else replaceSessions(result.sessions);
    })
    .catch((error: unknown) => {
      // 실패하면 다음 홈 진입에서 다시 시도해요.
      if (sessionLink?.promise === promise) sessionLink = null;
      throw error;
    });
  sessionLink = { key: anonymousUser.key, promise };
  return promise;
}

export default function App() {
  const [outingId, setOutingId] = useState(currentOutingId);
  const [anonymousUser, setAnonymousUser] = useState<{
    key: string;
    canLinkLocalSessions: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initializeAnonymousUser().then((identity) => {
      if (!cancelled) setAnonymousUser(identity);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => setOutingId(currentOutingId());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    try {
      return graniteEvent.addEventListener("backEvent", {
        onEvent: () => {
          const backEvent = new Event(APP_BACK_EVENT, { cancelable: true });
          if (!window.dispatchEvent(backEvent)) return;

          if (currentOutingId()) {
            navigate("/");
            return;
          }

          void closeView().catch(() => {
            if (window.history.length > 1) window.history.back();
          });
        },
        onError: () => {
          // 일반 브라우저에서는 네이티브 뒤로가기 이벤트를 제공하지 않아요.
        },
      });
    } catch {
      return undefined;
    }
  }, []);

  return outingId ? (
    <OutingPage
      key={outingId}
      outingId={outingId}
      onHome={() => navigate("/")}
    />
  ) : (
    <HomePage
      anonymousUser={anonymousUser}
      onOpenOuting={(id) => navigate(`/outing/${id}`)}
    />
  );
}

function describeRecommendationWeather(
  weather: OutingWeather | null,
  status: WeatherStatus | undefined,
) {
  if (weather) {
    return `${weather.maxTemperature}℃ · ${weather.condition} ${weather.precipitationProbability}% · ${weather.uvLabel}`;
  }
  if (status === "out_of_range") {
    return "예보는 출발 15일 전부터 반영돼요. 지금은 활동과 장소에 맞춰 골랐어요";
  }
  if (status === "unavailable") {
    return "예보를 잠시 불러오지 못해 활동과 장소에 맞춰 골랐어요";
  }
  return "활동과 장소에 맞춰 준비물을 골랐어요";
}

function HomePage({
  anonymousUser,
  onOpenOuting,
}: {
  anonymousUser: {
    key: string;
    canLinkLocalSessions: boolean;
  } | null;
  onOpenOuting: (outingId: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>(1);
  const createFormRef = useRef<HTMLFormElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [crowdHighlights, setCrowdHighlights] = useState<Place[]>([]);
  const [crowdHighlightsLoading, setCrowdHighlightsLoading] = useState(true);
  const [weatherHighlights, setWeatherHighlights] = useState<RegionalWeather[]>(
    [],
  );
  const [weatherHighlightsLoading, setWeatherHighlightsLoading] =
    useState(true);
  const [userLocation, setUserLocation] = useState<UserCoordinates | null>(
    null,
  );
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "granted" | "unavailable"
  >("idle");
  const [locationWeather, setLocationWeather] =
    useState<OutingWeather | null>(null);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [smartRecommendations, setSmartRecommendations] = useState<
    SmartRecommendation[]
  >([]);
  const [weatherPreview, setWeatherPreview] = useState("");
  const [itemsTouched, setItemsTouched] = useState(false);
  const itemsTouchedRef = useRef(false);
  const customItemCountRef = useRef(0);
  const presetPlaceIdRef = useRef("yeouido-hangang");
  // 사용자가 모임 이름을 직접 고치기 전까지는 장소·유형에 맞춰 이름을 제안해요.
  const titleEditedRef = useRef(false);
  const [recommending, setRecommending] = useState(false);
  const [maxItems, setMaxItems] = useState(15);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [sessions, setSessions] = useState<SavedSession[]>(getSavedSessions);
  const [outingSummaries, setOutingSummaries] = useState<
    Map<string, OutingSummary>
  >(new Map());
  const [deleteTarget, setDeleteTarget] = useState<SavedSession | null>(null);
  const [deletingOutingId, setDeletingOutingId] = useState<string | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const [customPlaceMode, setCustomPlaceMode] = useState(false);
  const [customPlaceQuery, setCustomPlaceQuery] = useState("");
  const [customPlaceResults, setCustomPlaceResults] = useState<Place[]>([]);
  const [selectedCustomPlace, setSelectedCustomPlace] =
    useState<Place | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => {
    const summer = isSummerSeason();
    return {
      title: summer ? "한강 물놀이" : "한강 피크닉",
      date: addDaysToDateKey(todayDateKey(), 1),
      placeId: "yeouido-hangang",
      activityType: summer ? "water-play" : "picnic",
      expectedPeople: 4,
      creatorName: "",
    };
  });
  const [tossDisplayName, setTossDisplayName] = useState("");
  const [expectedPeopleDraft, setExpectedPeopleDraft] = useState("4");
  const selectedCustomPlaceId = selectedCustomPlace?.id ?? "";
  const selectedCustomPlaceName = selectedCustomPlace?.name ?? "";
  const selectedCustomPlaceLatitude = selectedCustomPlace?.latitude ?? 0;
  const selectedCustomPlaceLongitude = selectedCustomPlace?.longitude ?? 0;
  const sharedSummerTypeValue = new URLSearchParams(
    window.location.search,
  ).get("summerType");
  const sharedSummerType = isSummerTypeKey(sharedSummerTypeValue)
    ? sharedSummerTypeValue
    : null;
  const sharedSummerName = getSharedDisplayName(window.location.search);
  const [mySummerType, setMySummerType] =
    useState<SummerTypeKey | null>(getSavedSummerType);
  const [activeTab, setActiveTab] = useState<HomeTab>(() =>
    getInitialHomeTab(sharedSummerType),
  );
  const [homeHighlightIndex, setHomeHighlightIndex] = useState(0);
  const [homeHighlightPaused, setHomeHighlightPaused] = useState(false);
  const rotatingHomePlaces = useMemo(() => {
    const liveCrowdById = new Map(
      crowdHighlights.map((place) => [place.id, place]),
    );
    const placeById = new Map(places.map((place) => [place.id, place]));
    return HOME_PLACE_ORDER.flatMap((id) => {
      const place = liveCrowdById.get(id) ?? placeById.get(id);
      return place?.currentCrowd ? [place] : [];
    });
  }, [crowdHighlights, places]);

  useEffect(() => {
    if (!anonymousUser) return;
    let cancelled = false;
    linkAnonymousSessions(anonymousUser)
      .then(() => {
        if (cancelled) return;
        const next = getSavedSessions();
        setSessions((current) =>
          sameSessionList(current, next) ? current : next,
        );
      })
      .catch(() => {
        // 식별키 동기화가 실패해도 기존 로컬 세션으로 계속 이용해요.
      });
    return () => {
      cancelled = true;
    };
  }, [anonymousUser]);

  useEffect(() => {
    Promise.all([listPlaces(), listItemOptions()])
      .then(([placeResult, itemResult]) => {
        setPlaces(placeResult.places);
        setCrowdHighlights((current) =>
          current.length > 0
            ? current
            : placeResult.places
                .filter(
                  (place) =>
                    place.city === "서울" &&
                    place.currentCrowd?.liveSupported,
                )
                .slice(0, 4),
        );
        setItemOptions(itemResult.options);
        setActivities(itemResult.activities);
        setMaxItems(itemResult.maxItems);
        setSelectedItemKeys(
          itemResult.options
            .filter((option) => option.recommended)
            .map((option) => option.key),
        );
      })
      .catch(() => setError("장소 목록을 불러오지 못했어요."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listWeatherHighlights()
      .then((result) => {
        if (!cancelled) setWeatherHighlights(result.regions);
      })
      .catch(() => {
        // 날씨 카드는 독립 기능이라 실패해도 모임 생성 흐름은 유지해요.
      })
      .finally(() => {
        if (!cancelled) setWeatherHighlightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "places" || locationStatus !== "idle") return;
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationStatus("granted");
      },
      () => {
        setLocationStatus("unavailable");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: 6_000,
      },
    );
  }, [activeTab, locationStatus]);

  useEffect(() => {
    if (!userLocation) {
      setLocationWeather(null);
      return;
    }
    let cancelled = false;
    getLocationWeather(userLocation.latitude, userLocation.longitude)
      .then((result) => {
        if (!cancelled) setLocationWeather(result.weather);
      })
      .catch(() => {
        if (!cancelled) setLocationWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userLocation]);

  useEffect(() => {
    let cancelled = false;
    listCrowdHighlights()
      .then((result) => {
        if (!cancelled) setCrowdHighlights(result.places);
      })
      .catch(() => {
        // 초기 장소 목록의 예상값을 유지해 슬라이더가 비지 않게 해요.
      })
      .finally(() => {
        if (!cancelled) setCrowdHighlightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (homeHighlightIndex < rotatingHomePlaces.length) return;
    setHomeHighlightIndex(0);
  }, [homeHighlightIndex, rotatingHomePlaces.length]);

  useEffect(() => {
    if (
      activeTab !== "home" ||
      homeHighlightPaused ||
      rotatingHomePlaces.length <= 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setHomeHighlightIndex(
        (current) => (current + 1) % rotatingHomePlaces.length,
      );
    }, 5_500);
    return () => window.clearInterval(timer);
  }, [
    activeTab,
    homeHighlightPaused,
    rotatingHomePlaces.length,
  ]);

  useEffect(() => {
    if (activeTab !== "home") setHomeHighlightPaused(false);
  }, [activeTab]);

  useEffect(() => {
    const handleAppBack = (event: Event) => {
      if (document.querySelector(".sheet-layer")) return;
      if (activeTab === "home") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveTab("home");
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      url.searchParams.delete("summerType");
      url.searchParams.delete("summerName");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener(APP_BACK_EVENT, handleAppBack);
    return () => window.removeEventListener(APP_BACK_EVENT, handleAppBack);
  }, [activeTab]);

  useEffect(() => {
    if (sessions.length === 0) {
      setOutingSummaries(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      // 토큰 없이 복구된 모임은 익명 키로만 요약을 받을 수 있어 키를 먼저 기다려요.
      if (sessions.some((session) => !session.token)) {
        await waitForAnonymousUser();
      }
      return loadOutingSummaries(sessions);
    })().then(({ summaries, missing }) => {
      if (cancelled) return;
      if (missing.length > 0) {
        // 삭제됐거나 보관 기간이 지나 서버에서 사라진 모임은 목록에서도 지워요.
        const missingIds = new Set(missing);
        missing.forEach((id) => removeSession(id));
        setSessions((current) =>
          current.filter((session) => !missingIds.has(session.outingId)),
        );
      }
      setOutingSummaries(
        new Map(summaries.map((summary) => [summary.outingId, summary])),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  useEffect(() => {
    if (!createOpen || !customPlaceMode) return;
    const query = customPlaceQuery.trim();
    if (query.length < 2) {
      setCustomPlaceResults([]);
      setPlaceSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPlaceSearching(true);
      searchPlaces(query)
        .then((result) => {
          if (!cancelled) setCustomPlaceResults(result.places);
        })
        .catch(() => {
          if (!cancelled) setCustomPlaceResults([]);
        })
        .finally(() => {
          if (!cancelled) setPlaceSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [createOpen, customPlaceMode, customPlaceQuery]);

  useEffect(() => {
    if (
      !createOpen ||
      !form.date ||
      !form.placeId ||
      !form.activityType ||
      (customPlaceMode && !selectedCustomPlaceId)
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRecommending(true);
      getPackingRecommendations({
        activityType: form.activityType,
        placeId: form.placeId,
        customPlace: selectedCustomPlaceId
          ? {
              id: selectedCustomPlaceId,
              name: selectedCustomPlaceName,
              latitude: selectedCustomPlaceLatitude,
              longitude: selectedCustomPlaceLongitude,
            }
          : undefined,
        startsAt: `${form.date}T10:00:00+09:00`,
        expectedPeople: form.expectedPeople,
      })
        .then((result) => {
          if (cancelled) return;
          setSmartRecommendations(result.recommendations);
          // 사용자가 직접 고친 선택은 추천값으로 덮어쓰지 않아요.
          if (!itemsTouchedRef.current) {
            setSelectedItemKeys(
              result.recommendations
                .map((recommendation) => recommendation.key)
                .slice(0, Math.max(0, maxItems - customItemCountRef.current)),
            );
          }
          setWeatherPreview(
            describeRecommendationWeather(result.weather, result.weatherStatus),
          );
          setError("");
        })
        .catch(() => {
          if (!cancelled) {
            setError("스마트 추천을 불러오지 못했어요. 직접 골라도 돼요.");
          }
        })
        .finally(() => {
          if (!cancelled) setRecommending(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    createOpen,
    form.activityType,
    form.date,
    form.expectedPeople,
    form.placeId,
    customPlaceMode,
    maxItems,
    selectedCustomPlaceId,
    selectedCustomPlaceLatitude,
    selectedCustomPlaceLongitude,
    selectedCustomPlaceName,
  ]);

  useEffect(() => {
    customItemCountRef.current = customItems.length;
  }, [customItems.length]);

  const itemCount = selectedItemKeys.length + customItems.length;
  // 추천 장소 모드에서는 목록에 있는 장소만, 직접 검색 모드에서는 고른 장소가 있어야 해요.
  const hasValidPlace =
    Boolean(form.placeId) &&
    (customPlaceMode
      ? selectedCustomPlace != null
      : places.some((place) => place.id === form.placeId));
  const selectedActivity =
    activities.find((activity) => activity.key === form.activityType) ?? null;
  const selectedPlaceName =
    selectedCustomPlace?.name ??
    places.find((place) => place.id === form.placeId)?.name ??
    "장소를 선택해 주세요";
  const selectedItemLabels = [
    ...itemOptions
      .filter((option) => selectedItemKeys.includes(option.key))
      .map((option) => option.label),
    ...customItems,
  ];
  const updateExpectedPeople = (value: number) => {
    const normalized = Math.min(
      MAX_EXPECTED_PEOPLE,
      Math.max(1, Math.round(value) || 1),
    );
    setExpectedPeopleDraft(String(normalized));
    setForm((current) => ({
      ...current,
      expectedPeople: normalized,
    }));
  };
  const recommendationReasons = useMemo(
    () =>
      new Map(
        smartRecommendations.map((recommendation) => [
          recommendation.key,
          `${recommendation.reason} · ${recommendation.quantityLabel}`,
        ]),
      ),
    [smartRecommendations],
  );
  const selectTab = (tab: HomeTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "home") {
      url.searchParams.delete("tab");
      url.searchParams.delete("summerType");
      url.searchParams.delete("summerName");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
    track("home_tab_selected", { tab });
  };
  const scrollCreateSheetToTop = () => {
    window.requestAnimationFrame(() => {
      createFormRef.current
        ?.closest<HTMLElement>(".sheet")
        ?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };
  const resolveTossDisplayName = async () => {
    if (tossDisplayName) return tossDisplayName;
    const displayName = await getTossUserDisplayName();
    if (!displayName) return "";
    setTossDisplayName(displayName);
    return displayName;
  };
  const openCreateSheet = () => {
    setCreateStep(1);
    setError("");
    setCreateOpen(true);
    void resolveTossDisplayName().then((displayName) => {
      if (!displayName) return;
      setForm((current) =>
        current.creatorName.trim()
          ? current
          : { ...current, creatorName: displayName },
      );
    });
  };
  const markItemsTouched = (touched: boolean) => {
    itemsTouchedRef.current = touched;
    setItemsTouched(touched);
  };
  const applyRecommendedItems = () => {
    markItemsTouched(false);
    setSelectedItemKeys(
      smartRecommendations
        .map((recommendation) => recommendation.key)
        .slice(0, Math.max(0, maxItems - customItems.length)),
    );
    setError("");
    track("create_recommendations_reapplied");
  };
  const suggestedTitle = (placeName: string, activityType: string) => {
    const activityLabel =
      activities.find((activity) => activity.key === activityType)?.label ??
      "모임";
    return `${placeName.replace(" 한강공원", " 한강")} ${activityLabel}`.slice(
      0,
      32,
    );
  };
  const selectPresetPlace = (place: Place) => {
    presetPlaceIdRef.current = place.id;
    setForm((current) => ({
      ...current,
      placeId: place.id,
      title: titleEditedRef.current
        ? current.title
        : suggestedTitle(place.name, current.activityType),
    }));
    setError("");
  };
  const startCreateWithPreset = (preset: OutingSuggestion) => {
    setCustomPlaceMode(false);
    setSelectedCustomPlace(null);
    if (preset.placeId) presetPlaceIdRef.current = preset.placeId;
    setForm((current) => ({
      ...current,
      title: preset.title.slice(0, 32),
      // 추천에 장소가 없으면 직접 검색했던 장소 대신 마지막 추천 장소로 돌아가요.
      placeId: preset.placeId ?? presetPlaceIdRef.current,
      activityType: preset.activityType,
    }));
    openCreateSheet();
  };
  const startCreateAtPlace = (place: Place) => {
    const waterActivity = waterActivityForCategory(place.category);
    startCreateWithPreset({
      title: `${place.name} ${waterActivity ? "물놀이" : "피크닉"}`,
      placeId: place.id,
      activityType: waterActivity ? "water-play" : "picnic",
    });
    track("popular_summer_place_selected", { place_id: place.id });
  };

  const requestDeleteOuting = (session: SavedSession) => {
    setDeleteError("");
    setDeleteTarget(session);
  };

  const confirmDeleteOuting = async () => {
    if (!deleteTarget || deletingOutingId) return;
    setDeletingOutingId(deleteTarget.outingId);
    setDeleteError("");
    try {
      await deleteOuting(deleteTarget.outingId, deleteTarget.token);
      removeSession(deleteTarget.outingId);
      setSessions(getSavedSessions());
      setDeleteNotice(`‘${deleteTarget.title}’ 모임을 삭제했어요.`);
      track("outing_deleted", { outing_id: deleteTarget.outingId });
      setDeleteTarget(null);
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : "모임을 삭제하지 못했어요.",
      );
    } finally {
      setDeletingOutingId(null);
    }
  };
  const closeCreateSheet = () => {
    setCreateOpen(false);
    setCreateStep(1);
    setError("");
  };
  const goToCreateStep = (step: CreateStep) => {
    setCreateStep(step);
    setError("");
    scrollCreateSheetToTop();
    track("outing_create_step_viewed", { step });
  };
  const nextCreateStep = () => {
    if (createStep === 1) {
      if (!form.title.trim()) {
        setError("모임 이름을 입력해 주세요.");
        return;
      }
      if (!form.date) {
        setError("모임 날짜를 선택해 주세요.");
        return;
      }
      if (!form.creatorName.trim()) {
        setError("친구들이 알아볼 수 있도록 내 이름을 입력해 주세요.");
        return;
      }
      if (!form.activityType) {
        setError("모임 유형을 선택해 주세요.");
        return;
      }
    }
    if (createStep === 2) {
      updateExpectedPeople(Number(expectedPeopleDraft));
      if (!hasValidPlace) {
        setError("함께 갈 장소를 선택해 주세요.");
        return;
      }
    }
    if (createStep === 3 && itemCount === 0) {
      setError("함께 챙길 준비물을 하나 이상 골라 주세요.");
      return;
    }
    goToCreateStep(Math.min(4, createStep + 1) as CreateStep);
  };
  const previousCreateStep = () => {
    goToCreateStep(Math.max(1, createStep - 1) as CreateStep);
  };

  const toggleCreateItem = (option: ItemOption) => {
    setError("");
    markItemsTouched(true);
    setSelectedItemKeys((current) => {
      if (current.includes(option.key)) {
        return current.filter((key) => key !== option.key);
      }
      if (current.length + customItems.length >= maxItems) {
        setError(`준비물은 최대 ${maxItems}개까지 고를 수 있어요.`);
        return current;
      }
      return [...current, option.key];
    });
  };

  const addCreateCustomItem = () => {
    const label = customDraft.trim().replace(/\s+/g, " ").slice(0, 16);
    if (!label) return;
    if (
      customItems.some(
        (item) => item.toLocaleLowerCase() === label.toLocaleLowerCase(),
      )
    ) {
      setError("이미 추가한 준비물이에요.");
      return;
    }
    if (itemCount >= maxItems) {
      setError(`준비물은 최대 ${maxItems}개까지 고를 수 있어요.`);
      return;
    }
    markItemsTouched(true);
    setCustomItems((current) => [...current, label]);
    setCustomDraft("");
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const created = await createOuting({
        title: form.title,
        placeId: form.placeId,
        startsAt: `${form.date}T10:00:00+09:00`,
        activityType: form.activityType,
        expectedPeople: form.expectedPeople,
        creatorName: form.creatorName,
        itemKeys: selectedItemKeys,
        customItems,
        customPlace: selectedCustomPlace ?? undefined,
        avatarKey: summerTypeAvatarKey(mySummerType),
      });
      saveSession(created.session, created.outing.outing);
      markItemsTouched(false);
      setCustomItems([]);
      track("outing_created", {
        place_id: form.placeId,
      });
      setSessions(getSavedSessions());
      closeCreateSheet();
      onOpenOuting(created.outing.outing.id);
    } catch (submitError) {
      setError(errorMessage(submitError, "모임을 만들지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  };

  const shareSummerType = async (
    result: SummerTypeResult,
  ): Promise<ShareOutcome> => {
    const displayName = normalizeUserDisplayName(
      await resolveTossDisplayName(),
    );
    const shareParams = new URLSearchParams({ summerType: result.key });
    if (displayName) shareParams.set("summerName", displayName);
    const message = [
      `🌞 ${displayName ? `${displayName}님의` : "내"} 여름 준비 캐릭터는 ‘${result.name}’`,
      `시그니처 준비물은 ${result.signatureItem}!`,
      "너는 8종 캐릭터 중 어떤 유형인지 1분 만에 확인해봐 👇",
    ].join("\n");
    let files: File[] | undefined;
    try {
      const imageResponse = await fetch(result.image);
      const imageBlob = await imageResponse.blob();
      files = [
        new File([imageBlob], `chaengyeosum-${result.key}.webp`, {
          type: imageBlob.type || "image/webp",
        }),
      ];
    } catch {
      files = undefined;
    }
    const outcome = await shareContent({
      title: `챙겨썸 | ${result.name}`,
      message,
      deepLink: `intoss://${APP_NAME}?${shareParams.toString()}`,
      webLink: `${window.location.origin}/?${shareParams.toString()}`,
      files,
    });
    track("summer_type_shared", { result: result.key, outcome });
    return outcome;
  };
  const featuredCrowdPlace =
    rotatingHomePlaces[homeHighlightIndex] ??
    places[0] ??
    null;
  const featuredCrowd = featuredCrowdPlace?.currentCrowd ?? null;
  const featuredWeatherRegion =
    weatherHighlights.find(
      (region) => region.id === weatherRegionIdForPlace(featuredCrowdPlace),
    ) ??
    weatherHighlights[0] ??
    null;
  const featuredWeather = featuredWeatherRegion?.weather ?? null;
  const featuredPlaceName =
    featuredCrowdPlace?.name
      .replace(" 한강공원", "")
      .replace("해수욕장", "") ?? "여름 장소";
  const featuredCrowdHeadline = crowdHeadline(featuredCrowd);
  const featuredWeatherLabel = weatherHighlightsLoading
    ? "지역 날씨를 불러오는 중"
    : featuredWeather
      ? `${featuredWeatherRegion?.name ?? "지역"} ${featuredWeather.maxTemperature}° · ${featuredWeather.condition} · 비 ${featuredWeather.precipitationProbability}%`
      : "지역 날씨와 예상 혼잡도 확인";
  const nearestWeatherRegion = useMemo(() => {
    if (weatherHighlights.length === 0) return null;
    if (!userLocation) {
      return (
        weatherHighlights.find((region) => region.id === "seoul") ??
        weatherHighlights[0]
      );
    }
    return weatherHighlights.reduce((nearest, region) =>
      geoDistance(userLocation, region) <
      geoDistance(userLocation, nearest)
        ? region
        : nearest,
    );
  }, [userLocation, weatherHighlights]);
  const placesHeaderWeather =
    locationWeather ?? nearestWeatherRegion?.weather ?? null;
  const placesHeaderWeatherLabel =
    locationStatus === "granted" && locationWeather
      ? "현재 위치"
      : locationStatus === "granted" && nearestWeatherRegion
        ? `${nearestWeatherRegion.name} 근처`
        : "서울 날씨";
  const featuredFreshnessLabel = featuredCrowd
    ? `${formatKoreaTime(featuredCrowd.observedAt)} 기준 · ${
        featuredCrowd.mode === "live" ? "서울 실시간" : "시간대 예상"
      }`
    : crowdHighlightsLoading
      ? "혼잡 정보를 불러오는 중"
      : "장소별 혼잡 정보 확인";

  const { upcoming: upcomingSessions, past: pastSessions } = splitSessions(
    sessions,
    outingSummaries,
  );
  const nextSession = upcomingSessions[0] ?? null;
  const summerSeason = isSummerSeason();
  const outingsShortcutLabel =
    sessions.length === 0
      ? "첫 모임을 만들어보세요"
      : upcomingSessions.length > 0
        ? `${upcomingSessions.length}개 모임 준비 중`
        : "지난 모임 다시 보기";

  return (
    <main className="app home-app" aria-label="챙겨썸">
      {activeTab === "home" ? (
        <>
          <section className="home-hero">
            <img
              className="hero-image"
              src="/assets/hero-picnic.png"
              alt=""
              draggable={false}
            />
            <div className="home-hero__content">
              <h1>
                {summerSeason ? "이번 여름 모임," : "다가오는 모임,"}
                <br />
                같이 챙겨요
              </h1>
              <p>
                {summerSeason
                  ? "모임을 만들고 친구들과 준비물을 나눠 맡아보세요."
                  : "날씨에 맞는 준비물을 추천받고 친구들과 나눠 맡아보세요."}
              </p>
              <button
                className="home-primary"
                type="button"
                onClick={openCreateSheet}
              >
                <PlusIcon aria-hidden="true" />
                새 모임 만들기
              </button>
            </div>
          </section>

          <section
            className="home-overview"
            aria-labelledby="home-overview-title"
          >
            <div className="home-overview__heading">
              <div>
                <p className="eyebrow">SUMMER TOOLBOX</p>
                <h2 id="home-overview-title">무엇을 확인할까요?</h2>
              </div>
              <span>필요한 기능만 골라보세요</span>
            </div>
            <div className="home-shortcuts">
              <button
                className="home-shortcut home-shortcut--places"
                type="button"
                aria-label={`장소와 날씨. ${featuredPlaceName}, 지금 ${featuredCrowdHeadline}. ${featuredWeatherLabel}. ${featuredFreshnessLabel}`}
                onClick={() => selectTab("places")}
                onPointerEnter={() => setHomeHighlightPaused(true)}
                onPointerLeave={() => setHomeHighlightPaused(false)}
                onFocus={() => setHomeHighlightPaused(true)}
                onBlur={() => setHomeHighlightPaused(false)}
              >
                <img
                  className="home-shortcut__background"
                  src={
                    featuredCrowdPlace?.imageUrl ??
                    "/assets/home-card-places-v2.webp"
                  }
                  alt=""
                  draggable={false}
                />
                <span
                  className="home-shortcut__summary"
                  key={featuredCrowdPlace?.id ?? "places-loading"}
                >
                  <span className="home-shortcut__eyebrow">
                    장소와 날씨
                  </span>
                  <strong className="home-shortcut__headline">
                    <span>{featuredPlaceName}, 지금</span>
                    <span>{featuredCrowdHeadline}</span>
                  </strong>
                  <span className="home-shortcut__weather">
                    {featuredWeatherLabel}
                  </span>
                  <small>{featuredFreshnessLabel}</small>
                </span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button
                className="home-shortcut home-shortcut--type"
                type="button"
                onClick={() => selectTab("type")}
              >
                <img
                  className="home-shortcut__background"
                  src="/assets/home-card-personality-v1.webp"
                  alt=""
                  draggable={false}
                />
                <span className="home-shortcut__content">
                  <strong>성향 테스트</strong>
                  <small>나의 여름 준비 캐릭터</small>
                </span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button
                className="home-shortcut home-shortcut--outings"
                type="button"
                onClick={() => selectTab("outings")}
              >
                <img
                  className="home-shortcut__background"
                  src="/assets/home-card-outings-v1.webp"
                  alt=""
                  draggable={false}
                />
                <span className="home-shortcut__content">
                  <strong>내 모임</strong>
                  <small>{outingsShortcutLabel}</small>
                </span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </div>

            {nextSession ? (
              <div className="home-next-outing">
                <div>
                  <strong>다가오는 모임</strong>
                  <button type="button" onClick={() => selectTab("outings")}>
                    모두 보기
                  </button>
                </div>
                <OutingList
                  sessions={[nextSession]}
                  summaries={outingSummaries}
                  onOpenOuting={onOpenOuting}
                />
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {activeTab === "places" ? (
        <section
          className="home-tab-page home-tab-page--places"
          aria-labelledby="places-tab-title"
        >
          <header className="home-tab-header">
            <p className="eyebrow">SUMMER MAP</p>
            <div className="places-tab-title-row">
              <h1 id="places-tab-title">장소와 날씨</h1>
              <div
                className="places-current-weather"
                aria-label={`${placesHeaderWeatherLabel} ${
                  placesHeaderWeather
                    ? `${placesHeaderWeather.maxTemperature}도 ${placesHeaderWeather.condition}`
                    : "확인 중"
                }`}
              >
                <SunIcon aria-hidden="true" />
                <span>
                  <small>{placesHeaderWeatherLabel}</small>
                  <strong>
                    {placesHeaderWeather
                      ? `${placesHeaderWeather.maxTemperature}° · ${placesHeaderWeather.condition}`
                      : "확인 중"}
                  </strong>
                </span>
              </div>
            </div>
            <span>어디로 갈지, 언제 출발할지 한눈에 확인해요.</span>
          </header>
          <CrowdHighlightsCarousel
            places={crowdHighlights}
            loading={crowdHighlightsLoading}
          />
          <PopularSummerPlaces
            places={places}
            onCreateOuting={startCreateAtPlace}
            userLocation={userLocation}
          />
          <WeatherHighlightsCarousel
            regions={weatherHighlights}
            loading={weatherHighlightsLoading}
          />
        </section>
      ) : null}

      {activeTab === "type" ? (
        <section
          className="home-tab-page home-tab-page--type"
          aria-labelledby="type-tab-title"
        >
          <header className="home-tab-header">
            <p className="eyebrow">1 MINUTE TEST</p>
            <h1 id="type-tab-title">나의 여름 준비 유형</h1>
            <span>친구와 결과를 나누고 찰떡 준비 파트너를 찾아보세요.</span>
          </header>
          <SummerTypeTest
            sharedType={sharedSummerType}
            sharedName={sharedSummerName}
            onTrack={track}
            onShare={shareSummerType}
            onResultChange={setMySummerType}
          />
          <SummerCrewBuilder
            myType={mySummerType}
            myName={tossDisplayName}
            sharedType={sharedSummerType}
            sharedName={sharedSummerName}
            onResolveMyName={resolveTossDisplayName}
            onTrack={track}
            onCreateOuting={(suggestion) => startCreateWithPreset(suggestion)}
          />
        </section>
      ) : null}

      {activeTab === "outings" ? (
        <section
          className="home-tab-page home-tab-page--outings"
          aria-labelledby="outings-tab-title"
        >
          <header className="home-tab-header home-tab-header--with-action">
            <div>
              <p className="eyebrow">MY SUMMER</p>
              <h1 id="outings-tab-title">
                {summerSeason ? "내 여름 모임" : "내 모임"}
              </h1>
              <span>준비 중인 모임과 친구들의 진행률을 확인해요.</span>
            </div>
            <button
              type="button"
              aria-label="새 모임 만들기"
              onClick={openCreateSheet}
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </header>
          {deleteNotice ? (
            <p className="outing-delete-notice" role="status">
              {deleteNotice}
            </p>
          ) : null}
          <div className="outing-tab-count">
            <span>다가오는 모임</span>
            <strong>{upcomingSessions.length}개</strong>
          </div>
          <OutingList
            sessions={upcomingSessions}
            summaries={outingSummaries}
            onOpenOuting={onOpenOuting}
            onDeleteOuting={requestDeleteOuting}
            deletingOutingId={deletingOutingId}
            onCreate={openCreateSheet}
            emptyTitle={
              pastSessions.length > 0
                ? "다가오는 모임이 없어요"
                : "아직 모임이 없어요"
            }
            emptyDescription="모임을 만들면 친구들과 준비물을 나눠 맡을 수 있어요."
          />
          {pastSessions.length > 0 ? (
            <>
              <div className="outing-tab-count outing-tab-count--past">
                <span>지난 모임</span>
                <strong>{pastSessions.length}개</strong>
              </div>
              <OutingList
                sessions={pastSessions}
                summaries={outingSummaries}
                onOpenOuting={onOpenOuting}
                onDeleteOuting={requestDeleteOuting}
                deletingOutingId={deletingOutingId}
              />
            </>
          ) : null}
        </section>
      ) : null}

      <nav className="home-bottom-nav" aria-label="챙겨썸 주요 기능">
        <button
          className={activeTab === "home" ? "is-active" : ""}
          type="button"
          aria-current={activeTab === "home" ? "page" : undefined}
          onClick={() => selectTab("home")}
        >
          <HomeIcon aria-hidden="true" />
          <span>홈</span>
        </button>
        <button
          className={activeTab === "places" ? "is-active" : ""}
          type="button"
          aria-current={activeTab === "places" ? "page" : undefined}
          onClick={() => selectTab("places")}
        >
          <GlobeIcon aria-hidden="true" />
          <span>장소</span>
        </button>
        <button
          className={activeTab === "type" ? "is-active" : ""}
          type="button"
          aria-current={activeTab === "type" ? "page" : undefined}
          onClick={() => selectTab("type")}
        >
          <MagicWandIcon aria-hidden="true" />
          <span>성향</span>
        </button>
        <button
          className={activeTab === "outings" ? "is-active" : ""}
          type="button"
          aria-current={activeTab === "outings" ? "page" : undefined}
          onClick={() => selectTab("outings")}
        >
          <CalendarIcon aria-hidden="true" />
          <span>내 모임</span>
        </button>
      </nav>

      <Sheet
        open={deleteTarget != null}
        onClose={() => {
          if (deletingOutingId) return;
          setDeleteTarget(null);
          setDeleteError("");
        }}
        title="모임을 삭제할까요?"
        description="삭제하면 초대받은 친구도 더 이상 이 모임을 열 수 없어요."
      >
        <div className="delete-outing-confirm">
          <div>
            <CalendarIcon aria-hidden="true" />
            <span>
              <strong>{deleteTarget?.title}</strong>
              <small>
                {deleteTarget
                  ? `${formatOutingDate(deleteTarget.startsAt)} · ${deleteTarget.placeName}`
                  : ""}
              </small>
            </span>
          </div>
          <p>준비물, 담당자, 진행 기록이 모두 삭제되며 되돌릴 수 없어요.</p>
          {deleteError ? <p className="form-error">{deleteError}</p> : null}
          <div className="delete-outing-confirm__actions">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={Boolean(deletingOutingId)}
            >
              취소
            </button>
            <button
              className="sheet-danger"
              type="button"
              onClick={() => void confirmDeleteOuting()}
              disabled={Boolean(deletingOutingId)}
            >
              <TrashIcon aria-hidden="true" />
              {deletingOutingId ? "삭제하고 있어요…" : "모임 삭제"}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={createOpen}
        onClose={closeCreateSheet}
        title="새 모임 만들기"
        description={CREATE_STEPS[createStep - 1].description}
      >
        <form
          ref={createFormRef}
          className="create-form create-form--steps"
          onSubmit={(event) => {
            if (createStep < 4) {
              event.preventDefault();
              nextCreateStep();
              return;
            }
            void submit(event);
          }}
        >
          <ol className="create-progress" aria-label="모임 만들기 진행 단계">
            {CREATE_STEPS.map((step) => (
              <li
                className={
                  step.key === createStep
                    ? "is-current"
                    : step.key < createStep
                      ? "is-complete"
                      : ""
                }
                key={step.key}
              >
                <button
                  type="button"
                  disabled={step.key > createStep}
                  aria-current={step.key === createStep ? "step" : undefined}
                  aria-label={`${step.key}단계 ${step.label}${
                    step.key < createStep ? ", 완료" : ""
                  }`}
                  onClick={() => goToCreateStep(step.key)}
                >
                  <span>
                    {step.key < createStep ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      step.key
                    )}
                  </span>
                  <strong>{step.label}</strong>
                </button>
              </li>
            ))}
          </ol>

          {createStep === 1 ? (
            <section
              className="create-step-panel"
              aria-labelledby="create-step-basic"
            >
              <div className="create-step-heading">
                <span>STEP 1</span>
                <h3 id="create-step-basic">어떤 모임을 만들까요?</h3>
                <p>친구들이 알아보기 쉬운 정보부터 입력해요.</p>
              </div>
              <label>
                <span>모임 이름</span>
                <input
                  autoFocus
                  required
                  maxLength={32}
                  value={form.title}
                  onChange={(event) => {
                    titleEditedRef.current = true;
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }));
                  }}
                  placeholder="예: 한강 물놀이"
                />
              </label>
              <div className="form-grid">
                <label>
                  <span>날짜</span>
                  <input
                    required
                    type="date"
                    min={todayDateKey()}
                    max={addDaysToDateKey(todayDateKey(), 365)}
                    value={form.date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>내 이름</span>
                  <input
                    required
                    maxLength={10}
                    value={form.creatorName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        creatorName: event.target.value,
                      }))
                    }
                    placeholder="닉네임"
                  />
                </label>
              </div>
              <fieldset className="activity-picker">
                <legend>어떤 모임인가요?</legend>
                <div>
                  {activities.map((activity) => (
                    <button
                      className={
                        form.activityType === activity.key ? "is-selected" : ""
                      }
                      type="button"
                      key={activity.key}
                      aria-pressed={form.activityType === activity.key}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          activityType: activity.key,
                        }))
                      }
                    >
                      <span>{activityIcon(activity.key)}</span>
                      <strong>{activity.label}</strong>
                      <small>{activity.description}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          {createStep === 2 ? (
            <section
              className="create-step-panel"
              aria-labelledby="create-step-place"
            >
              <div className="create-step-heading">
                <span>STEP 2</span>
                <h3 id="create-step-place">어디서 몇 명이 만날까요?</h3>
                <p>인원과 장소에 맞춰 날씨와 준비물 수량을 계산해요.</p>
              </div>
              <div className="people-count-field">
                <span>함께 가는 인원</span>
                <div className="people-count-control">
                  <button
                    type="button"
                    aria-label="인원 한 명 줄이기"
                    disabled={form.expectedPeople <= 1}
                    onClick={() =>
                      updateExpectedPeople(form.expectedPeople - 1)
                    }
                  >
                    −
                  </button>
                  <label>
                    <input
                      required
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_EXPECTED_PEOPLE}
                      value={expectedPeopleDraft}
                      aria-label="함께 가는 인원수"
                      onChange={(event) => {
                        const value = event.target.value;
                        setExpectedPeopleDraft(value);
                        if (value !== "" && Number.isFinite(Number(value))) {
                          setForm((current) => ({
                            ...current,
                            expectedPeople: Math.min(
                              MAX_EXPECTED_PEOPLE,
                              Math.max(1, Math.round(Number(value))),
                            ),
                          }));
                        }
                      }}
                      onBlur={() =>
                        updateExpectedPeople(Number(expectedPeopleDraft))
                      }
                    />
                    <span>명</span>
                  </label>
                  <button
                    type="button"
                    aria-label="인원 한 명 늘리기"
                    disabled={form.expectedPeople >= MAX_EXPECTED_PEOPLE}
                    onClick={() =>
                      updateExpectedPeople(form.expectedPeople + 1)
                    }
                  >
                    +
                  </button>
                </div>
                <small>
                  인원에 맞춰 물·수건·공용 준비물 수량을 계산해요.
                </small>
              </div>
              <fieldset className="place-picker">
                <legend>만날 장소</legend>
                <div className="place-picker__tabs">
                  <button
                    type="button"
                    aria-pressed={!customPlaceMode}
                    onClick={() => {
                      setCustomPlaceMode(false);
                      setSelectedCustomPlace(null);
                      // 직접 검색 전에 골랐던 추천 장소로 돌아가요.
                      setForm((current) => ({
                        ...current,
                        placeId:
                          presetPlaceIdRef.current ||
                          (places[0]?.id ?? "yeouido-hangang"),
                      }));
                    }}
                  >
                    추천 장소
                  </button>
                  <button
                    type="button"
                    aria-pressed={customPlaceMode}
                    onClick={() => {
                      setCustomPlaceMode(true);
                      setForm((current) => ({ ...current, placeId: "" }));
                    }}
                  >
                    직접 검색
                  </button>
                </div>
                {customPlaceMode ? (
                  <div className="place-search">
                    <label>
                      <MagnifyingGlassIcon aria-hidden="true" />
                      <input
                        aria-label="장소 검색"
                        value={customPlaceQuery}
                        onChange={(event) => {
                          setCustomPlaceQuery(event.target.value);
                          setSelectedCustomPlace(null);
                          setForm((current) => ({ ...current, placeId: "" }));
                        }}
                        placeholder="예: 송정해수욕장, 서울숲"
                      />
                    </label>
                    {selectedCustomPlace ? (
                      <div className="place-search__selected">
                        <CheckIcon aria-hidden="true" />
                        <span>
                          <strong>{selectedCustomPlace.name}</strong>
                          <small>이 장소의 좌표로 날씨를 확인해요.</small>
                        </span>
                      </div>
                    ) : (
                      <div className="place-search__results">
                        {placeSearching ? (
                          <p>장소를 찾고 있어요…</p>
                        ) : customPlaceQuery.trim().length >= 2 &&
                          customPlaceResults.length === 0 ? (
                          <p>
                            검색 결과가 없어요. 지역명을 함께 입력해 보세요.
                          </p>
                        ) : (
                          customPlaceResults.map((place) => (
                            <button
                              type="button"
                              key={place.id}
                              onClick={() => {
                                setSelectedCustomPlace(place);
                                setCustomPlaceQuery(place.name);
                                setForm((current) => ({
                                  ...current,
                                  placeId: place.id,
                                }));
                              }}
                            >
                              <span>{place.name}</span>
                              <ChevronRightIcon aria-hidden="true" />
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <PlacePicker
                    places={places}
                    value={form.placeId}
                    onChange={selectPresetPlace}
                    userLocation={userLocation}
                  />
                )}
              </fieldset>
            </section>
          ) : null}

          {createStep === 3 ? (
            <section
              className="create-step-panel"
              aria-labelledby="create-items-title"
            >
              <div className="create-step-heading">
                <span>STEP 3</span>
                <h3 id="create-items-title">무엇을 함께 챙길까요?</h3>
                <p>날씨·장소·인원에 맞춘 추천에서 필요한 것만 골라보세요.</p>
              </div>
              <div className="smart-recommendation-intro" role="status">
                <span>
                  <MagicWandIcon aria-hidden="true" />
                </span>
                <div>
                  <strong>
                    {recommending
                      ? "날씨를 확인하고 있어요"
                      : itemsTouched
                        ? "직접 고른 준비물을 유지하고 있어요"
                        : "날씨와 활동에 맞춰 골랐어요"}
                  </strong>
                  <small>
                    {weatherPreview || "추천 준비물을 준비 중이에요"}
                  </small>
                </div>
                {itemsTouched && smartRecommendations.length > 0 ? (
                  <button
                    className="smart-recommendation-intro__reset"
                    type="button"
                    onClick={applyRecommendedItems}
                  >
                    <ReloadIcon aria-hidden="true" />
                    추천대로
                  </button>
                ) : null}
              </div>
              <div className="item-picker-heading">
                <div>
                  <strong>함께 챙길 준비물</strong>
                  <span>선택한 준비물은 친구들과 나눠 맡아요</span>
                </div>
                <b>
                  {itemCount}/{maxItems}
                </b>
              </div>
              <ItemPicker
                options={itemOptions}
                selectedKeys={new Set(selectedItemKeys)}
                recommendationReasons={recommendationReasons}
                onToggle={toggleCreateItem}
              />
              <div className="custom-item-input">
                <input
                  maxLength={16}
                  value={customDraft}
                  aria-label="직접 준비물 입력"
                  placeholder="목록에 없나요? 직접 입력"
                  onChange={(event) => setCustomDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCreateCustomItem();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!customDraft.trim() || itemCount >= maxItems}
                  onClick={addCreateCustomItem}
                >
                  추가
                </button>
              </div>
              {customItems.length > 0 ? (
                <div
                  className="custom-item-tags"
                  aria-label="직접 추가한 준비물"
                >
                  {customItems.map((item) => (
                    <span className="custom-item-tag" key={item}>
                      {item}
                      <button
                        type="button"
                        aria-label={`${item} 삭제`}
                        onClick={() =>
                          {
                            markItemsTouched(true);
                            setCustomItems((current) =>
                              current.filter(
                                (currentItem) => currentItem !== item,
                              ),
                            );
                          }
                        }
                      >
                        <Cross2Icon aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {createStep === 4 ? (
            <section
              className="create-step-panel create-review"
              aria-labelledby="create-step-review"
            >
              <div className="create-review__lead">
                <img
                  src="/assets/app-icon.png"
                  alt=""
                  draggable={false}
                />
                <div>
                  <span>STEP 4 · FINAL CHECK</span>
                  <h3 id="create-step-review">이대로 모임을 만들까요?</h3>
                  <p>만든 뒤에도 준비물은 자유롭게 바꿀 수 있어요.</p>
                </div>
              </div>
              <article className="create-review-card">
                <div className="create-review-card__heading">
                  <span>
                    <CalendarIcon aria-hidden="true" />
                  </span>
                  <div>
                    <small>모임 정보</small>
                    <strong>{form.title}</strong>
                  </div>
                  <button type="button" onClick={() => goToCreateStep(1)}>
                    수정
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>날짜</dt>
                    <dd>
                      {new Date(
                        `${form.date}T00:00:00`,
                      ).toLocaleDateString("ko-KR", {
                        month: "long",
                        day: "numeric",
                        weekday: "short",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>유형</dt>
                    <dd>{selectedActivity?.label ?? "여름 모임"}</dd>
                  </div>
                  <div>
                    <dt>내 이름</dt>
                    <dd>{form.creatorName}</dd>
                  </div>
                </dl>
              </article>
              <article className="create-review-card">
                <div className="create-review-card__heading">
                  <span>
                    <GlobeIcon aria-hidden="true" />
                  </span>
                  <div>
                    <small>장소와 인원</small>
                    <strong>{selectedPlaceName}</strong>
                  </div>
                  <button type="button" onClick={() => goToCreateStep(2)}>
                    수정
                  </button>
                </div>
                <p>{form.expectedPeople}명이 함께 가요</p>
              </article>
              <article className="create-review-card">
                <div className="create-review-card__heading">
                  <span>
                    <BackpackIcon aria-hidden="true" />
                  </span>
                  <div>
                    <small>함께 챙길 준비물</small>
                    <strong>{itemCount}개를 골랐어요</strong>
                  </div>
                  <button type="button" onClick={() => goToCreateStep(3)}>
                    수정
                  </button>
                </div>
                <div
                  className="create-review-card__items"
                  aria-label="선택한 준비물"
                >
                  {selectedItemLabels.slice(0, 6).map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                  {selectedItemLabels.length > 6 ? (
                    <span>+{selectedItemLabels.length - 6}개</span>
                  ) : null}
                </div>
              </article>
            </section>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}
          <div
            className={`create-step-actions${
              createStep === 1 ? " create-step-actions--single" : ""
            }`}
          >
            {createStep > 1 ? (
              <button
                className="create-step-back"
                type="button"
                onClick={previousCreateStep}
              >
                <ChevronLeftIcon aria-hidden="true" />
                이전
              </button>
            ) : null}
            {createStep < 4 ? (
              <button className="sheet-primary" type="submit">
                {createStep === 1
                  ? "장소와 인원 정하기"
                  : createStep === 2
                    ? "준비물 고르기"
                    : "마지막으로 확인하기"}
                <ChevronRightIcon aria-hidden="true" />
              </button>
            ) : (
              <button
                className="sheet-primary"
                type="submit"
                disabled={
                  submitting ||
                  places.length === 0 ||
                  itemOptions.length === 0 ||
                  itemCount === 0 ||
                  !hasValidPlace
                }
              >
                {submitting ? "모임을 만들고 있어요…" : "모임 만들기"}
              </button>
            )}
          </div>
        </form>
      </Sheet>
    </main>
  );
}
