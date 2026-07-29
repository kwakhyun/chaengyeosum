import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BackpackIcon,
  BoxIcon,
  CalendarIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  Cross2Icon,
  DashboardIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  LayersIcon,
  LightningBoltIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MobileIcon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
  RocketIcon,
  ShuffleIcon,
  SpeakerLoudIcon,
  StarFilledIcon,
  SunIcon,
  TokensIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  Analytics,
  closeView,
  getTossShareLink,
  graniteEvent,
  share,
} from "@apps-in-toss/web-framework";

import {
  addItem,
  completeMyItems,
  createAiBriefing,
  createOuting,
  deleteItem,
  getPlaceIntelligence,
  getPackingRecommendations,
  getOuting,
  joinOuting,
  listCrowdHighlights,
  listItemOptions,
  listPlaces,
  listWeatherHighlights,
  randomizeItems,
  searchSummerEvents,
  searchPlaces,
  toggleEventReaction,
  updateItem,
} from "./api";
import { AiBriefingCard } from "./components/AiBriefingCard";
import { CrowdHighlightsCarousel } from "./components/CrowdHighlightsCarousel";
import { PlaceIntelligenceCard } from "./components/PlaceIntelligenceCard";
import { Sheet } from "./components/Sheet";
import {
  isSummerTypeKey,
  SummerTypeTest,
  type SummerTypeKey,
  type SummerTypeResult,
} from "./components/SummerTypeTest";
import { WeatherHighlightsCarousel } from "./components/WeatherHighlightsCarousel";
import {
  getSavedSessions,
  getSession,
  saveSession,
} from "./session";
import type {
  ActivityOption,
  AiOutingBriefing,
  CrowdSignal,
  OutingBundle,
  ItemOption,
  OutingEvent,
  PackingItem,
  Participant,
  ParticipantSession,
  Place,
  RegionalWeather,
  SavedSession,
  SmartRecommendation,
  SummerEventSearch,
} from "./types";
import "./styles.css";

const APP_NAME = "chaengyeosum";
const APP_BACK_EVENT = "chaengyeosum:back";
const SHARE_OG_IMAGE_URL =
  "https://chaengyeosum-mobile.khyun97.chatgpt.site/og.png";

function getBriefingSnapshot(bundle: OutingBundle) {
  return JSON.stringify({
    outing: {
      title: bundle.outing.title,
      placeName: bundle.outing.placeName,
      startsAt: bundle.outing.startsAt,
      activityType: bundle.outing.activityType,
      expectedPeople: bundle.outing.expectedPeople,
    },
    participantCount: bundle.participants.length,
    weather: bundle.weather
      ? {
          maxTemperature: bundle.weather.maxTemperature,
          precipitationProbability:
            bundle.weather.precipitationProbability,
          uvLabel: bundle.weather.uvLabel,
          condition: bundle.weather.condition,
        }
      : null,
    items: bundle.items.map((item) => ({
      key: item.key,
      assigned: item.owner != null,
      done: item.done,
      quantityLabel: item.quantityLabel,
    })),
  });
}

function hasTossBridge() {
  return (
    typeof (
      window as Window & {
        ReactNativeWebView?: { postMessage?: unknown };
      }
    ).ReactNativeWebView?.postMessage === "function"
  );
}

function track(name: string, params: Record<string, string | number> = {}) {
  if (!hasTossBridge()) return;
  try {
    void Analytics.click({ log_name: name, ...params });
  } catch {
    // 분석 실패가 핵심 흐름을 막지 않게 해요.
  }
}

function getTomorrowInputValue() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateLabel(startsAt: string) {
  const eventDate = new Date(startsAt);
  const today = new Date();
  const todayKey = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).valueOf();
  const eventKey = new Date(
    eventDate.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate(),
  ).valueOf();
  const dayDiff = Math.round((eventKey - todayKey) / 86_400_000);
  const relative =
    dayDiff === 0 ? "오늘" : dayDiff === 1 ? "내일" : dayDiff > 1 ? `D-${dayDiff}` : "지난 모임";
  return `${relative} · ${eventDate.getMonth() + 1}월 ${eventDate.getDate()}일`;
}

function crowdHeadline(crowd: CrowdSignal | null) {
  if (!crowd) return "혼잡도를 확인해요";
  if (crowd.level === "relaxed") return "여유로워요";
  if (crowd.level === "normal") return "무난해요";
  if (crowd.level === "busy") return "약간 붐벼요";
  return "많이 붐벼요";
}

function daysUntil(startsAt: string) {
  const eventDate = new Date(startsAt);
  const today = new Date();
  return Math.round(
    (new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
    ).valueOf() -
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).valueOf()) /
      86_400_000,
  );
}

function activityIcon(activityType: string) {
  if (activityType === "water-play") {
    return <BackpackIcon aria-hidden="true" />;
  }
  if (activityType === "festival") {
    return <SpeakerLoudIcon aria-hidden="true" />;
  }
  if (activityType === "camping") {
    return <DashboardIcon aria-hidden="true" />;
  }
  if (activityType === "trip") {
    return <RocketIcon aria-hidden="true" />;
  }
  return <SunIcon aria-hidden="true" />;
}

function avatarSrc(avatarKey: string) {
  const allowed = new Set(["me", "minji", "junho", "seoyeon"]);
  const safeKey = allowed.has(avatarKey) ? avatarKey : "me";
  return `/assets/avatar-${safeKey}.png`;
}

function ItemVisual({
  visual,
  compact = false,
}: {
  visual: string;
  compact?: boolean;
}) {
  if (visual.startsWith("asset:")) {
    const filename = visual.slice("asset:".length).replaceAll("/", "");
    return (
      <img
        className={compact ? "item-image item-image--compact" : "item-image"}
        src={`/assets/${filename}`}
        alt=""
        draggable={false}
      />
    );
  }

  const iconName = visual.startsWith("icon:")
    ? visual.slice("icon:".length)
    : "custom";
  const icon =
    iconName === "sun" ? (
      <SunIcon aria-hidden="true" />
    ) : iconName === "backpack" ? (
      <BackpackIcon aria-hidden="true" />
    ) : iconName === "mobile" ? (
      <MobileIcon aria-hidden="true" />
    ) : iconName === "lightning" ? (
      <LightningBoltIcon aria-hidden="true" />
    ) : iconName === "camera" ? (
      <CameraIcon aria-hidden="true" />
    ) : iconName === "layers" ? (
      <LayersIcon aria-hidden="true" />
    ) : iconName === "heart" ? (
      <HeartIcon aria-hidden="true" />
    ) : iconName === "trash" ? (
      <TrashIcon aria-hidden="true" />
    ) : iconName === "magic-wand" ? (
      <MagicWandIcon aria-hidden="true" />
    ) : iconName === "cool" ? (
      <DashboardIcon aria-hidden="true" />
    ) : iconName === "speaker" ? (
      <SpeakerLoudIcon aria-hidden="true" />
    ) : iconName === "tokens" ? (
      <TokensIcon aria-hidden="true" />
    ) : (
      <BoxIcon aria-hidden="true" />
    );

  return (
    <span
      className={`item-icon-visual${compact ? " item-icon-visual--compact" : ""}`}
    >
      {icon}
    </span>
  );
}

function ItemPicker({
  options,
  selectedKeys,
  disabled,
  recommendationReasons,
  onToggle,
}: {
  options: ItemOption[];
  selectedKeys: Set<string>;
  disabled?: boolean;
  recommendationReasons?: Map<string, string>;
  onToggle: (option: ItemOption) => void;
}) {
  return (
    <div className="item-option-grid">
      {options.map((option) => {
        const selected = selectedKeys.has(option.key);
        return (
          <button
            className={`item-option${selected ? " is-selected" : ""}`}
            type="button"
            key={option.key}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(option)}
          >
            <ItemVisual visual={option.visual} compact />
            <span>{option.label}</span>
            {recommendationReasons?.has(option.key) ? (
              <small>{recommendationReasons.get(option.key)}</small>
            ) : null}
            {selected ? (
              <span className="item-option__check" aria-hidden="true">
                <CheckIcon />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ProgressShareCard({ bundle }: { bundle: OutingBundle }) {
  const readyCount = bundle.items.filter((item) => item.done).length;
  const unassigned = bundle.items.filter((item) => item.owner == null);
  const percent =
    bundle.items.length > 0
      ? Math.round((readyCount / bundle.items.length) * 100)
      : 0;
  const day = daysUntil(bundle.outing.startsAt);
  const dayLabel =
    day === 0 ? "오늘" : day > 0 ? `D-${day}` : "다녀온 모임";

  return (
    <article className="progress-share-card">
      <div className="progress-share-card__top">
        <span>{dayLabel}</span>
        <b>챙겨썸</b>
      </div>
      <h3>{bundle.outing.title}</h3>
      <p>
        {readyCount}/{bundle.items.length}개 준비 완료
        {unassigned.length > 0
          ? ` · ${unassigned.length}개 주인 찾는 중`
          : " · 담당자 모두 확정"}
      </p>
      <div
        className="share-progress-track"
        role="progressbar"
        aria-label="공유 카드 준비 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-share-card__bottom">
        <div className="avatar-stack" aria-label="참여자">
          {bundle.participants.slice(0, 4).map((participant) => (
            <img
              key={participant.id}
              src={avatarSrc(participant.avatarKey)}
              alt=""
              draggable={false}
            />
          ))}
        </div>
        <span>
          {unassigned.length > 0
            ? `${unassigned
                .slice(0, 2)
                .map((item) => item.label)
                .join("·")} 맡아줄래?`
            : "준비 상황 같이 확인해요"}
        </span>
      </div>
    </article>
  );
}

function eventMessage(event: OutingEvent) {
  const name = event.participant?.name ?? "친구";
  const itemLabel = event.itemLabel ?? "준비물";
  const lastCharacter = itemLabel.at(-1) ?? "";
  const characterCode = lastCharacter.charCodeAt(0);
  const hasFinalConsonant =
    characterCode >= 0xac00 &&
    characterCode <= 0xd7a3 &&
    (characterCode - 0xac00) % 28 !== 0;
  const itemWithObjectParticle = `${itemLabel}${hasFinalConsonant ? "을" : "를"}`;
  if (event.type === "created") return `${name}님이 모임을 만들었어요`;
  if (event.type === "joined") return `${name}님이 함께 준비해요`;
  if (event.type === "claimed") {
    return `${name}님이 ${itemWithObjectParticle} 맡았어요`;
  }
  if (event.type === "completed") {
    return `${name}님이 ${event.itemLabel ?? "준비물"} 준비를 끝냈어요`;
  }
  if (event.type === "completed_mine") {
    return `${name}님의 준비물이 모두 끝났어요`;
  }
  if (event.type === "randomized") {
    return `${name}님이 ${event.itemLabel ?? "여러"}개를 랜덤 배정했어요`;
  }
  if (event.type === "item_added") {
    return `${name}님이 ${itemWithObjectParticle} 추가했어요`;
  }
  if (event.type === "item_deleted") {
    return `${name}님이 목록을 정리했어요`;
  }
  if (event.type === "reopened") {
    return `${name}님이 ${itemWithObjectParticle} 다시 확인해요`;
  }
  return `${name}님이 준비 상태를 바꿨어요`;
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

function OutingList({
  sessions,
  summaries,
  onOpenOuting,
}: {
  sessions: SavedSession[];
  summaries: Map<
    string,
    { ready: number; total: number; unassigned: number }
  >;
  onOpenOuting: (outingId: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="empty-card">
        <CalendarIcon aria-hidden="true" />
        <strong>아직 만든 모임이 없어요</strong>
        <span>첫 모임을 만들면 여기에 모아드려요.</span>
      </div>
    );
  }

  return (
    <div className="outing-cards">
      {sessions.map((session) => {
        const summary = summaries.get(session.outingId);
        const percent =
          summary && summary.total > 0
            ? Math.round((summary.ready / summary.total) * 100)
            : 0;
        return (
          <button
            className="outing-card"
            type="button"
            key={session.outingId}
            onClick={() => onOpenOuting(session.outingId)}
          >
            <span className="outing-card__icon">
              <CalendarIcon aria-hidden="true" />
            </span>
            <span className="outing-card__copy">
              <strong>{session.title}</strong>
              <span>
                {formatDateLabel(session.startsAt)} · {session.placeName}
              </span>
              {summary ? (
                <span className="outing-card__status">
                  <i aria-hidden="true">
                    <i style={{ width: `${percent}%` }} />
                  </i>
                  <b>
                    {summary.ready}/{summary.total} 준비
                    {summary.unassigned > 0
                      ? ` · ${summary.unassigned}개 주인 찾는 중`
                      : ""}
                  </b>
                </span>
              ) : null}
            </span>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [outingId, setOutingId] = useState(currentOutingId);

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
    <OutingPage outingId={outingId} onHome={() => navigate("/")} />
  ) : (
    <HomePage onOpenOuting={(id) => navigate(`/outing/${id}`)} />
  );
}

function HomePage({
  onOpenOuting,
}: {
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
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [smartRecommendations, setSmartRecommendations] = useState<
    SmartRecommendation[]
  >([]);
  const [weatherPreview, setWeatherPreview] = useState("");
  const [recommending, setRecommending] = useState(false);
  const [maxItems, setMaxItems] = useState(15);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [sessions, setSessions] = useState<SavedSession[]>(getSavedSessions);
  const [outingSummaries, setOutingSummaries] = useState<
    Map<string, { ready: number; total: number; unassigned: number }>
  >(new Map());
  const [customPlaceMode, setCustomPlaceMode] = useState(false);
  const [customPlaceQuery, setCustomPlaceQuery] = useState("");
  const [customPlaceResults, setCustomPlaceResults] = useState<Place[]>([]);
  const [selectedCustomPlace, setSelectedCustomPlace] =
    useState<Place | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "한강 물놀이",
    date: getTomorrowInputValue(),
    placeId: "yeouido-hangang",
    activityType: "water-play",
    expectedPeople: 4,
    creatorName: "",
  });
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
  const [activeTab, setActiveTab] = useState<HomeTab>(() =>
    getInitialHomeTab(sharedSummerType),
  );
  const [homeHighlightIndex, setHomeHighlightIndex] = useState(0);
  const [homeHighlightPaused, setHomeHighlightPaused] = useState(false);
  const rotatingCrowdHighlights = useMemo(
    () =>
      crowdHighlights
        .filter((place) => place.currentCrowd != null)
        .slice(0, 4),
    [crowdHighlights],
  );

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
    if (homeHighlightIndex < rotatingCrowdHighlights.length) return;
    setHomeHighlightIndex(0);
  }, [homeHighlightIndex, rotatingCrowdHighlights.length]);

  useEffect(() => {
    if (
      activeTab !== "home" ||
      homeHighlightPaused ||
      rotatingCrowdHighlights.length <= 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setHomeHighlightIndex(
        (current) => (current + 1) % rotatingCrowdHighlights.length,
      );
    }, 5_500);
    return () => window.clearInterval(timer);
  }, [
    activeTab,
    homeHighlightPaused,
    rotatingCrowdHighlights.length,
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
    Promise.allSettled(
      sessions.map(async (saved) => {
        const bundle = await getOuting(saved.outingId, {
          token: saved.token,
        });
        return [
          saved.outingId,
          {
            ready: bundle.items.filter((item) => item.done).length,
            total: bundle.items.length,
            unassigned: bundle.items.filter((item) => item.owner == null)
              .length,
          },
        ] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      setOutingSummaries(
        new Map(
          results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        ),
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
          setSelectedItemKeys(
            result.recommendations
              .map((recommendation) => recommendation.key)
              .slice(0, maxItems),
          );
          setWeatherPreview(
            result.weather
              ? `${result.weather.maxTemperature}℃ · ${result.weather.condition} ${result.weather.precipitationProbability}% · ${result.weather.uvLabel}`
              : "활동 유형에 맞춰 준비물을 골랐어요",
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

  const itemCount = selectedItemKeys.length + customItems.length;
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
    const normalized = Math.min(999, Math.max(1, Math.round(value) || 1));
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
  const openCreateSheet = () => {
    setCreateStep(1);
    setError("");
    setCreateOpen(true);
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
      if (!form.placeId || (customPlaceMode && selectedCustomPlace == null)) {
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
      });
      saveSession(created.session, created.outing.outing);
      track("outing_created", {
        place_id: form.placeId,
      });
      setSessions(getSavedSessions());
      closeCreateSheet();
      onOpenOuting(created.outing.outing.id);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "모임을 만들지 못했어요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const shareSummerType = async (
    result: SummerTypeResult,
  ): Promise<"shared" | "copied"> => {
    const deepLink = `intoss://${APP_NAME}?summerType=${result.key}`;
    const webLink = `${window.location.origin}/?summerType=${result.key}`;
    const message = [
      `🌞 내 여름 준비 캐릭터는 ‘${result.name}’`,
      `시그니처 준비물은 ${result.signatureItem}!`,
      "너는 어떤 유형인지 30초 만에 확인해봐 👇",
    ].join("\n");
    let shareResult: "shared" | "copied" = "copied";

    try {
      if (hasTossBridge()) {
        const tossLink = await getTossShareLink(
          deepLink,
          SHARE_OG_IMAGE_URL,
        );
        await share({ message: `${message}\n\n${tossLink}` });
        shareResult = "shared";
      } else if (window.navigator.share) {
        const imageResponse = await fetch(result.image);
        const imageBlob = await imageResponse.blob();
        const imageFile = new File(
          [imageBlob],
          `chaengyeosum-${result.key}.webp`,
          { type: imageBlob.type || "image/webp" },
        );
        const canShareImage =
          typeof window.navigator.canShare === "function" &&
          window.navigator.canShare({ files: [imageFile] });
        await window.navigator.share({
          title: `챙겨썸 | ${result.name}`,
          text: message,
          url: webLink,
          ...(canShareImage ? { files: [imageFile] } : {}),
        });
        shareResult = "shared";
      } else {
        await window.navigator.clipboard.writeText(`${message}\n\n${webLink}`);
      }
    } catch {
      await window.navigator.clipboard?.writeText(`${message}\n\n${webLink}`);
    } finally {
      track("summer_type_shared", { result: result.key });
    }

    return shareResult;
  };
  const featuredCrowdPlace =
    rotatingCrowdHighlights[homeHighlightIndex] ??
    crowdHighlights[0] ??
    null;
  const featuredCrowd = featuredCrowdPlace?.currentCrowd ?? null;
  const featuredWeather =
    weatherHighlights.find((region) => region.id === "seoul")?.weather ??
    weatherHighlights[0]?.weather ??
    null;
  const featuredPlaceName =
    featuredCrowdPlace?.name.replace(" 한강공원", "") ?? "한강";
  const featuredCrowdHeadline = crowdHeadline(featuredCrowd);
  const featuredWeatherLabel = weatherHighlightsLoading
    ? "서울 날씨를 불러오는 중"
    : featuredWeather
      ? `서울 ${featuredWeather.maxTemperature}° · ${featuredWeather.condition} · 비 ${featuredWeather.precipitationProbability}%`
      : "서울 날씨와 한강 혼잡도 확인";
  const featuredFreshnessLabel = featuredCrowd
    ? `${featuredCrowd.observedAt.slice(11, 16)} 기준 · ${
        featuredCrowd.mode === "live" ? "서울 실시간" : "시간대 예상"
      }`
    : crowdHighlightsLoading
      ? "혼잡 정보를 불러오는 중"
      : "장소별 혼잡 정보 확인";

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
                이번 여름 모임,
                <br />
                같이 챙겨요
              </h1>
              <p>모임을 만들고 친구들과 준비물을 나눠 맡아보세요.</p>
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
                  src="/assets/home-card-places-v2.webp"
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
                  <small>{sessions.length}개 모임 준비 중</small>
                </span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </div>

            {sessions.length > 0 ? (
              <div className="home-next-outing">
                <div>
                  <strong>최근 모임</strong>
                  <button type="button" onClick={() => selectTab("outings")}>
                    모두 보기
                  </button>
                </div>
                <OutingList
                  sessions={sessions.slice(0, 1)}
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
            <h1 id="places-tab-title">장소와 날씨</h1>
            <span>어디로 갈지, 언제 출발할지 한눈에 확인해요.</span>
          </header>
          <CrowdHighlightsCarousel
            places={crowdHighlights}
            loading={crowdHighlightsLoading}
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
            <p className="eyebrow">30 SECOND TEST</p>
            <h1 id="type-tab-title">나의 여름 준비 유형</h1>
            <span>친구와 결과를 나누고 찰떡 준비 파트너를 찾아보세요.</span>
          </header>
          <SummerTypeTest
            sharedType={sharedSummerType}
            onTrack={track}
            onShare={shareSummerType}
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
              <h1 id="outings-tab-title">내 여름 모임</h1>
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
          <div className="outing-tab-count">
            <span>전체</span>
            <strong>{sessions.length}개</strong>
          </div>
          <OutingList
            sessions={sessions}
            summaries={outingSummaries}
            onOpenOuting={onOpenOuting}
          />
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
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="예: 한강 물놀이"
                />
              </label>
              <div className="form-grid">
                <label>
                  <span>날짜</span>
                  <input
                    required
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
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
                      max={999}
                      value={expectedPeopleDraft}
                      aria-label="함께 가는 인원수"
                      onChange={(event) => {
                        const value = event.target.value;
                        setExpectedPeopleDraft(value);
                        if (value !== "" && Number.isFinite(Number(value))) {
                          setForm((current) => ({
                            ...current,
                            expectedPeople: Math.min(
                              999,
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
                    disabled={form.expectedPeople >= 999}
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
                      setForm((current) => ({
                        ...current,
                        placeId: places[0]?.id ?? "yeouido-hangang",
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
                  <select
                    required
                    aria-label="장소"
                    value={form.placeId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        placeId: event.target.value,
                      }))
                    }
                  >
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                        {place.currentCrowd
                          ? ` · ${place.currentCrowd.label}`
                          : ""}
                      </option>
                    ))}
                  </select>
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
                <p>AI 추천 목록에서 필요한 것만 골라보세요.</p>
              </div>
              <div className="smart-recommendation-intro" role="status">
                <span>
                  <MagicWandIcon aria-hidden="true" />
                </span>
                <div>
                  <strong>
                    {recommending
                      ? "날씨를 확인하고 있어요"
                      : "날씨와 활동에 맞춰 골랐어요"}
                  </strong>
                  <small>
                    {weatherPreview || "추천 준비물을 준비 중이에요"}
                  </small>
                </div>
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
                          setCustomItems((current) =>
                            current.filter(
                              (currentItem) => currentItem !== item,
                            ),
                          )
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
                  (customPlaceMode && selectedCustomPlace == null)
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

function OutingPage({
  outingId,
  onHome,
}: {
  outingId: string;
  onHome: () => void;
}) {
  const inviteCode = new URLSearchParams(window.location.search).get("invite");
  const [session, setSession] = useState<ParticipantSession | null>(() =>
    getSession(outingId),
  );
  const [bundle, setBundle] = useState<OutingBundle | null>(null);
  const [selectedItem, setSelectedItem] = useState<PackingItem | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [maxItems, setMaxItems] = useState(15);
  const [customDraft, setCustomDraft] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBriefing, setAiBriefing] =
    useState<AiOutingBriefing | null>(null);
  const [aiSnapshot, setAiSnapshot] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [crowd, setCrowd] = useState<CrowdSignal | null>(null);
  const [crowdLoading, setCrowdLoading] = useState(false);
  const [crowdError, setCrowdError] = useState("");
  const [summerEvents, setSummerEvents] =
    useState<SummerEventSearch | null>(null);
  const [summerEventsLoading, setSummerEventsLoading] = useState(false);
  const [summerEventsError, setSummerEventsError] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState("");
  const previousReadyCount = useRef<number | null>(null);

  const refresh = useCallback(
    async (nextSession = session) => {
      try {
        const nextBundle = await getOuting(outingId, {
          token: nextSession?.token,
          inviteCode: nextSession ? undefined : (inviteCode ?? undefined),
        });
        setBundle(nextBundle);
        setError("");
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "모임을 불러오지 못했어요.",
        );
      } finally {
        setLoading(false);
      }
    },
    [inviteCode, outingId, session],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    listItemOptions()
      .then((result) => {
        setItemOptions(result.options);
        setMaxItems(result.maxItems);
      })
      .catch(() => setNotice("준비물 선택지를 불러오지 못했어요."));
  }, []);

  useEffect(() => {
    if (!session) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, 10_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh, session]);

  const loadCrowd = useCallback(async () => {
    if (!session) return;
    setCrowdLoading(true);
    setCrowdError("");
    try {
      const result = await getPlaceIntelligence(outingId, session.token);
      setCrowd(result.crowd);
      track("place_crowd_loaded", {
        mode: result.crowd.mode,
        level: result.crowd.level,
      });
    } catch (loadError) {
      setCrowdError(
        loadError instanceof Error
          ? loadError.message
          : "혼잡도를 불러오지 못했어요.",
      );
    } finally {
      setCrowdLoading(false);
    }
  }, [outingId, session]);

  useEffect(() => {
    void loadCrowd();
  }, [loadCrowd]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!highlightedItemId) return;
    const timer = window.setTimeout(() => setHighlightedItemId(""), 1800);
    return () => window.clearTimeout(timer);
  }, [highlightedItemId]);

  useEffect(() => {
    if (!bundle) return;
    const nextReadyCount = bundle.items.filter((item) => item.done).length;
    if (
      previousReadyCount.current != null &&
      previousReadyCount.current < bundle.items.length &&
      nextReadyCount === bundle.items.length
    ) {
      setCelebrationOpen(true);
    }
    previousReadyCount.current = nextReadyCount;
  }, [bundle]);

  const runMutation = async (
    mutate: (activeSession: ParticipantSession) => Promise<unknown>,
  ) => {
    if (!session || busy) return false;
    setBusy(true);
    try {
      await mutate(session);
      await refresh(session);
      return true;
    } catch (mutationError) {
      setNotice(
        mutationError instanceof Error
          ? mutationError.message
          : "변경하지 못했어요.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const assign = async (participant: Participant) => {
    if (!selectedItem) return;
    const changed = await runMutation((activeSession) =>
      updateItem(outingId, selectedItem.id, activeSession.token, {
        ownerId: participant.id,
      }),
    );
    if (!changed) return;
    track("packing_item_assigned", {
      item_id: selectedItem.key,
    });
    setSelectedItem(null);
    setNotice(`${participant.name}님이 ${selectedItem.label}을 맡았어요`);
  };

  const toggle = async (item: PackingItem) => {
    await runMutation((activeSession) =>
      updateItem(outingId, item.id, activeSession.token, {
        done: !item.done,
      }),
    );
    track("packing_item_toggled", { item_id: item.key });
  };

  const finishMine = async () => {
    if (!bundle?.viewer) return;
    const changed = await runMutation((activeSession) =>
      completeMyItems(outingId, activeSession.token),
    );
    if (!changed) return;
    setNotice(`${bundle.viewer.name}님의 준비물을 모두 완료했어요`);
    track("my_packing_completed");
  };

  const claimForMe = async (item: PackingItem, closeAfter = false) => {
    if (!bundle?.viewer) return;
    const changed = await runMutation((activeSession) =>
      updateItem(outingId, item.id, activeSession.token, {
        ownerId: bundle.viewer?.id,
      }),
    );
    if (!changed) return;
    if (closeAfter) setClaimOpen(false);
    setNotice(`${item.label}, 내가 챙길게요!`);
    track("packing_item_self_claimed", { item_id: item.key });
  };

  const toggleCatalogItem = async (option: ItemOption) => {
    const existing = bundle?.items.find((item) => item.key === option.key);
    const changed = await runMutation((activeSession) =>
      existing
        ? deleteItem(outingId, existing.id, activeSession.token)
        : addItem(outingId, activeSession.token, { optionKey: option.key }),
    );
    if (changed) {
      setNotice(
        existing
          ? `${option.label}을 목록에서 뺐어요`
          : `${option.label}을 함께 챙겨요`,
      );
      track(existing ? "packing_item_deleted" : "packing_item_added", {
        item_id: option.key,
      });
    }
  };

  const addCustomItem = async () => {
    const label = customDraft.trim().replace(/\s+/g, " ").slice(0, 16);
    if (!label) return;
    const changed = await runMutation((activeSession) =>
      addItem(outingId, activeSession.token, { label }),
    );
    if (changed) {
      setCustomDraft("");
      setNotice(`${label}을 함께 챙겨요`);
      track("custom_packing_item_added");
    }
  };

  const removeCustomItem = async (item: PackingItem) => {
    const changed = await runMutation((activeSession) =>
      deleteItem(outingId, item.id, activeSession.token),
    );
    if (changed) {
      setNotice(`${item.label}을 목록에서 뺐어요`);
      track("packing_item_deleted", { item_id: "custom" });
    }
  };

  const applySmartRecommendations = async () => {
    if (!bundle) return;
    const existingKeys = new Set(bundle.items.map((item) => item.key));
    const availableSlots = Math.max(0, maxItems - bundle.items.length);
    const missing = (bundle.smartRecommendations ?? [])
      .filter((recommendation) => !existingKeys.has(recommendation.key))
      .slice(0, availableSlots);
    if (missing.length === 0) {
      setNotice("추천 준비물이 모두 목록에 있어요");
      return;
    }
    const changed = await runMutation(async (activeSession) => {
      for (const recommendation of missing) {
        await addItem(outingId, activeSession.token, {
          optionKey: recommendation.key,
        });
      }
    });
    if (!changed) return;
    setNotice(`날씨 맞춤 준비물 ${missing.length}개를 더했어요`);
    track("smart_packing_applied", { item_count: missing.length });
  };

  const handleRandomize = async () => {
    const changed = await runMutation((activeSession) =>
      randomizeItems(outingId, activeSession.token),
    );
    if (!changed) return;
    setRandomOpen(false);
    setNotice("남은 준비물을 공평하게 나눴어요");
    track("packing_items_randomized");
  };

  const reactToEvent = async (
    event: OutingEvent,
    reactionType: "heart" | "cheer",
  ) => {
    const changed = await runMutation((activeSession) =>
      toggleEventReaction(
        outingId,
        event.id,
        activeSession.token,
        reactionType,
      ),
    );
    if (!changed) return;
    track("activity_event_reacted", {
      reaction_type: reactionType,
    });
  };

  const dismissClaim = () => {
    setClaimOpen(false);
  };

  const handleAiGenerate = async () => {
    if (!bundle || !session || aiLoading) return;
    setAiLoading(true);
    setAiError("");
    track("ai_briefing_requested", { outing_id: outingId });
    try {
      const snapshot = getBriefingSnapshot(bundle);
      const result = await createAiBriefing(outingId, session.token);
      setAiBriefing(result.briefing);
      setAiSnapshot(snapshot);
      track("ai_briefing_generated", {
        outing_id: outingId,
        cached: result.meta.cached ? 1 : 0,
      });
    } catch (generationError) {
      setAiError(
        generationError instanceof Error
          ? generationError.message
          : "AI 브리핑을 만들지 못했어요.",
      );
      track("ai_briefing_failed", { outing_id: outingId });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSummerEventSearch = async () => {
    if (!session || summerEventsLoading) return;
    setSummerEventsLoading(true);
    setSummerEventsError("");
    track("summer_events_requested", { outing_id: outingId });
    try {
      const result = await searchSummerEvents(outingId, session.token);
      setSummerEvents(result.events);
      track("summer_events_loaded", {
        outing_id: outingId,
        event_count: result.events.events.length,
        cached: result.meta.cached ? 1 : 0,
      });
    } catch (searchError) {
      setSummerEventsError(
        searchError instanceof Error
          ? searchError.message
          : "행사 정보를 확인하지 못했어요.",
      );
      track("summer_events_failed", { outing_id: outingId });
    } finally {
      setSummerEventsLoading(false);
    }
  };

  const focusAiItem = (itemKey: string) => {
    if (!bundle) return;
    const item = bundle.items.find(
      (candidate) => candidate.key === itemKey,
    );
    if (!item) return;
    setHighlightedItemId(item.id);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`packing-item-${item.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    track("ai_briefing_action_opened", { item_id: item.key });
  };

  const handleAiShare = async () => {
    if (!bundle || !aiBriefing) return;
    const deepLink = `intoss://${APP_NAME}/outing/${bundle.outing.id}?invite=${encodeURIComponent(bundle.outing.inviteCode)}`;
    const webLink = `${window.location.origin}/outing/${bundle.outing.id}?invite=${encodeURIComponent(bundle.outing.inviteCode)}`;
    const message = [
      `☀️ ${bundle.outing.title} AI 준비 브리핑`,
      `“${aiBriefing.headline}”`,
      aiBriefing.shareCaption,
      "같이 확인하고 하나씩 맡아줘 👇",
      "",
    ].join("\n");
    let resultMessage = "AI 브리핑을 복사했어요";
    try {
      if (hasTossBridge()) {
        const tossLink = await getTossShareLink(
          deepLink,
          SHARE_OG_IMAGE_URL,
        );
        await share({ message: `${message}${tossLink}` });
        resultMessage = "AI 브리핑을 공유했어요";
      } else if (window.navigator.share) {
        await window.navigator.share({
          title: `${bundle.outing.title} AI 브리핑`,
          text: message,
          url: webLink,
        });
        resultMessage = "AI 브리핑을 공유했어요";
      } else {
        await window.navigator.clipboard.writeText(`${message}${webLink}`);
      }
    } catch {
      await window.navigator.clipboard?.writeText(`${message}${webLink}`);
    } finally {
      setNotice(resultMessage);
      track("ai_briefing_shared", { outing_id: outingId });
    }
  };

  const handleShare = async () => {
    if (!bundle) return;
    const deepLink = `intoss://${APP_NAME}/outing/${bundle.outing.id}?invite=${encodeURIComponent(bundle.outing.inviteCode)}`;
    const webLink = `${window.location.origin}/outing/${bundle.outing.id}?invite=${encodeURIComponent(bundle.outing.inviteCode)}`;
    const readyCount = bundle.items.filter((item) => item.done).length;
    const unassigned = bundle.items.filter((item) => item.owner == null);
    const day = daysUntil(bundle.outing.startsAt);
    const dayLabel = day === 0 ? "오늘" : day > 0 ? `D-${day}` : "";
    const ask =
      unassigned.length > 0
        ? `${unassigned
            .slice(0, 3)
            .map((item) => item.label)
            .join(" · ")} 중 하나 맡아줄래?`
        : "준비 상황 같이 확인해줘!";
    const message = [
      `🏖️ ${bundle.outing.title}, 같이 챙길래?`,
      `${dayLabel ? `${dayLabel} · ` : ""}준비 ${readyCount}/${bundle.items.length}`,
      ask,
      "하나 맡고 준비 완료까지 같이 가요 👇",
      "",
    ].join("\n");
    let resultMessage = "초대 링크를 복사했어요";
    try {
      if (hasTossBridge()) {
        const tossLink = await getTossShareLink(
          deepLink,
          SHARE_OG_IMAGE_URL,
        );
        await share({ message: `${message}${tossLink}` });
        resultMessage = "초대 링크를 공유했어요";
      } else {
        await window.navigator.clipboard.writeText(`${message}${webLink}`);
      }
    } catch {
      await window.navigator.clipboard?.writeText(`${message}${webLink}`);
    } finally {
      track("outing_invite_shared", { outing_id: outingId });
      setCopied(true);
      setNotice(resultMessage);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!bundle || error) {
    return (
      <StateScreen
        title={error || "모임을 찾지 못했어요."}
        description="초대 링크를 다시 확인하거나 내 모임으로 돌아가 주세요."
        actionLabel="내 모임으로"
        onAction={onHome}
      />
    );
  }

  const readyCount = bundle.items.filter((item) => item.done).length;
  const readyPercent =
    bundle.items.length > 0
      ? `${Math.round((readyCount / bundle.items.length) * 100)}%`
      : "0%";
  const myItems = bundle.viewer
    ? bundle.items.filter((item) => item.owner?.id === bundle.viewer?.id)
    : [];
  const myReady = myItems.length > 0 && myItems.every((item) => item.done);
  const unassignedItems = bundle.items.filter((item) => item.owner == null);
  const needsOwnItem =
    Boolean(bundle.viewer) &&
    bundle.participants.length >= 2 &&
    !bundle.items.some((item) => item.owner?.id === bundle.viewer?.id) &&
    unassignedItems.length > 0;
  const existingItemKeys = new Set(bundle.items.map((item) => item.key));
  const smartRecommendations = bundle.smartRecommendations ?? [];
  const events = bundle.events ?? [];
  const missingSmartRecommendations = smartRecommendations.filter(
    (recommendation) => !existingItemKeys.has(recommendation.key),
  );
  const eventDay = daysUntil(bundle.outing.startsAt);
  const unfinishedCount = bundle.items.length - readyCount;
  const aiBriefingStale =
    Boolean(aiBriefing) &&
    aiSnapshot !== "" &&
    aiSnapshot !== getBriefingSnapshot(bundle);

  return (
    <main className="app" aria-label={`${bundle.outing.title} 준비 화면`}>
      <section className="hero" aria-labelledby="outing-title">
        <img
          className="hero-image"
          src="/assets/hero-picnic.png"
          alt=""
          draggable={false}
        />
        <div className="hero-content">
          <p className="outing-date">
            {formatDateLabel(bundle.outing.startsAt)}
          </p>
          <h1 id="outing-title">
            {bundle.outing.title},
            <br />
            {bundle.participants.length}명이 준비 중
          </h1>
          <div className="weather-pill" aria-label="모임 날씨">
            <SunIcon aria-hidden="true" />
            {bundle.weather ? (
              <>
                <span>
                  {bundle.weather.maxTemperature}° · {bundle.weather.condition}{" "}
                  {bundle.weather.precipitationProbability}%
                </span>
                <strong>{bundle.weather.uvLabel}</strong>
              </>
            ) : (
              <span>{bundle.outing.placeName} · 예보 준비 중</span>
            )}
          </div>
        </div>
      </section>

      {!bundle.viewer && inviteCode ? (
        <section className="invite-entry-card" aria-labelledby="invite-entry-title">
          <div>
            <span>초대받은 모임이에요</span>
            <h2 id="invite-entry-title">친구들과 준비물을 나눠 맡아보세요</h2>
            <p>참여하기를 누른 뒤 이름과 내가 챙길 준비물을 골라요.</p>
          </div>
          <button type="button" onClick={() => setJoinOpen(true)}>
            모임 참여하기
          </button>
        </section>
      ) : null}

      <section className="readiness" aria-labelledby="readiness-title">
        <h2 id="readiness-title">
          <strong>{readyCount}</strong>
          <span>/ {bundle.items.length}개 준비</span>
        </h2>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="준비 진행률"
          aria-valuemin={0}
          aria-valuemax={bundle.items.length}
          aria-valuenow={readyCount}
        >
          <span style={{ width: readyPercent }} />
        </div>
      </section>

      {bundle.viewer && unassignedItems.length > 0 ? (
        <button
          className="invite-nudge"
          type="button"
          onClick={() => {
            setCopied(false);
            setInviteOpen(true);
          }}
        >
          <span className="invite-nudge__avatars">
            {bundle.participants.slice(0, 3).map((participant) => (
              <img
                key={participant.id}
                src={avatarSrc(participant.avatarKey)}
                alt=""
                draggable={false}
              />
            ))}
            <i>
              <PlusIcon aria-hidden="true" />
            </i>
          </span>
          <span>
            <strong>
              {unassignedItems.length}개 준비물의 주인을 찾고 있어요
            </strong>
            <small>친구에게 하나 맡아달라고 해볼까요?</small>
          </span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      ) : null}

      {needsOwnItem ? (
        <button
          className="claim-nudge"
          type="button"
          onClick={() => setClaimOpen(true)}
        >
          <span>
            <strong>내가 챙길 준비물을 골라볼까요?</strong>
            <small>아직 주인이 없는 준비물 {unassignedItems.length}개</small>
          </span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      ) : null}

      {bundle.viewer ? (
        <AiBriefingCard
          briefing={aiBriefing}
          loading={aiLoading}
          error={aiError}
          stale={aiBriefingStale}
          onGenerate={() => void handleAiGenerate()}
          onShare={() => void handleAiShare()}
          onFocusItem={focusAiItem}
        />
      ) : null}

      {bundle.viewer ? (
        <PlaceIntelligenceCard
          placeName={bundle.outing.placeName}
          crowd={crowd}
          crowdLoading={crowdLoading}
          crowdError={crowdError}
          events={summerEvents}
          eventLoading={summerEventsLoading}
          eventError={summerEventsError}
          onRefreshCrowd={() => void loadCrowd()}
          onSearchEvents={() => void handleSummerEventSearch()}
        />
      ) : null}

      <section className="smart-packing-card" aria-labelledby="smart-title">
        <div className="smart-packing-card__heading">
          <span>
            <MagicWandIcon aria-hidden="true" />
          </span>
          <div>
            <p>SMART PACKING</p>
            <h2 id="smart-title">이 날씨엔 이렇게 챙겨요</h2>
          </div>
        </div>
        <div className="smart-recommendation-list">
          {smartRecommendations.slice(0, 3).map((recommendation) => (
            <div key={recommendation.key}>
              <ItemVisual visual={recommendation.visual} compact />
              <span>
                <strong>{recommendation.label}</strong>
                <small>{recommendation.reason}</small>
                <b>{recommendation.quantityLabel}</b>
              </span>
            </div>
          ))}
        </div>
        <div className="smart-packing-actions">
          {missingSmartRecommendations.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void applySmartRecommendations()}
            >
              추천 {missingSmartRecommendations.length}개 반영
            </button>
          ) : (
            <span>
              <CheckIcon aria-hidden="true" />
              맞춤 준비물 반영 완료
            </span>
          )}
          {bundle.participants.length > 1 &&
          unassignedItems.length > 0 ? (
            <button
              className="randomize-open"
              type="button"
              onClick={() => setRandomOpen(true)}
            >
              <ShuffleIcon aria-hidden="true" />
              랜덤으로 나누기
            </button>
          ) : null}
        </div>
      </section>

      {eventDay >= 0 && eventDay <= 1 && unfinishedCount > 0 ? (
        <section className="last-check-card" aria-label="출발 전 마지막 점검">
          <CalendarIcon aria-hidden="true" />
          <span>
            <strong>
              {eventDay === 0 ? "오늘 출발해요" : "내일 출발해요"}
            </strong>
            <small>아직 {unfinishedCount}개가 준비 중이에요</small>
          </span>
          <b>마지막 점검</b>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="activity-feed" aria-labelledby="activity-title">
          <div>
            <h2 id="activity-title">친구들 소식</h2>
            <span>실시간</span>
          </div>
          <ul>
            {events.slice(0, 3).map((event) => (
              <li key={event.id}>
                {event.participant ? (
                  <img
                    src={avatarSrc(event.participant.avatarKey)}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span>
                    <StarFilledIcon aria-hidden="true" />
                  </span>
                )}
                <div className="activity-feed__content">
                  <p>{eventMessage(event)}</p>
                  {bundle.viewer ? (
                    <div className="activity-reactions">
                      <button
                        type="button"
                        aria-label="좋아요"
                        aria-pressed={event.viewerReaction === "heart"}
                        disabled={busy}
                        onClick={() => void reactToEvent(event, "heart")}
                      >
                        <HeartIcon aria-hidden="true" />
                        {event.reactions?.heart ?? 0}
                      </button>
                      <button
                        type="button"
                        aria-label="응원해요"
                        aria-pressed={event.viewerReaction === "cheer"}
                        disabled={busy}
                        onClick={() => void reactToEvent(event, "cheer")}
                      >
                        <StarFilledIcon aria-hidden="true" />
                        {event.reactions?.cheer ?? 0}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="packing-section" aria-labelledby="packing-title">
        <div className="packing-title-row">
          <h2 id="packing-title">함께 챙길 것</h2>
          <div className="packing-title-actions">
            <span>{bundle.outing.placeName}</span>
            {bundle.viewer ? (
              <button
                type="button"
                onClick={() => {
                  setCustomDraft("");
                  setManageOpen(true);
                }}
              >
                준비물 편집
              </button>
            ) : null}
          </div>
        </div>
        <div className="packing-list">
          {bundle.items.map((item) => (
            <article
              id={`packing-item-${item.id}`}
              className={`packing-row${item.done ? " is-done" : ""}${
                highlightedItemId === item.id ? " is-ai-target" : ""
              }`}
              key={item.id}
            >
              <button
                className="check-button"
                type="button"
                aria-label={`${item.label} ${
                  item.done ? "준비 취소" : "준비 완료"
                }`}
                aria-pressed={item.done}
                disabled={!session || busy}
                onClick={() => void toggle(item)}
              >
                {item.done ? <CheckIcon aria-hidden="true" /> : null}
              </button>
              <ItemVisual visual={item.visual} />
              <div className="packing-row__name">
                <h3>{item.label}</h3>
                <small>{item.quantityLabel}</small>
              </div>
              <button
                className={`owner${item.owner ? "" : " owner-empty"}`}
                type="button"
                disabled={!session || busy}
                aria-label={`${item.label} 담당자 ${
                  item.owner?.name ?? "내가 맡기"
                }`}
                onClick={() =>
                  item.owner
                    ? setSelectedItem(item)
                    : void claimForMe(item)
                }
              >
                {item.owner ? (
                  <>
                    <img
                      src={avatarSrc(item.owner.avatarKey)}
                      alt=""
                      draggable={false}
                    />
                    <span>
                      {item.owner.id === bundle.viewer?.id
                        ? "나"
                        : item.owner.name}
                    </span>
                  </>
                ) : (
                  <>
                    <PlusIcon aria-hidden="true" />
                    <span>내가 맡기</span>
                  </>
                )}
              </button>
            </article>
          ))}
        </div>
      </section>

      {bundle.viewer ? (
        <div className="action-dock" aria-label="준비 작업">
          <button
            className={`primary-action${myReady ? " is-complete" : ""}`}
            type="button"
            disabled={
              busy || (myItems.length === 0 && unassignedItems.length === 0)
            }
            onClick={() =>
              myItems.length === 0
                ? setClaimOpen(true)
                : void finishMine()
            }
          >
            {myItems.length === 0
              ? "준비물 하나 맡기"
              : myReady
                ? "준비 완료했어요"
                : "내 준비 끝내기"}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setCopied(false);
              setInviteOpen(true);
            }}
          >
            <PersonIcon aria-hidden="true" />
            진행률 공유하기
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="toast" role="status" aria-live="polite">
          <CheckIcon aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <Sheet
        open={claimOpen && unassignedItems.length > 0}
        onClose={dismissClaim}
        title="하나만 맡아볼까요?"
        description={`아직 주인이 없는 준비물이 ${unassignedItems.length}개예요. 내가 챙길 것을 하나 골라주세요.`}
      >
        <div className="claim-items">
          {unassignedItems.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={busy}
              onClick={() => void claimForMe(item, true)}
            >
              <ItemVisual visual={item.visual} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.quantityLabel} · 내가 챙길게</small>
              </span>
              <ChevronRightIcon aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          className="sheet-text-button"
          type="button"
          onClick={dismissClaim}
        >
          나중에 고를게요
        </button>
      </Sheet>

      <Sheet
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        title={`${selectedItem?.label ?? "준비물"}은 누가 챙길까요?`}
        description="담당자를 고르면 참여한 친구들에게도 바로 반영돼요."
      >
        <div className="people-grid">
          {bundle.participants.map((participant) => (
            <button
              key={participant.id}
              type="button"
              onClick={() => void assign(participant)}
            >
              <img
                src={avatarSrc(participant.avatarKey)}
                alt=""
                draggable={false}
              />
              <span>
                {participant.id === bundle.viewer?.id
                  ? "나"
                  : participant.name}
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={randomOpen}
        onClose={() => setRandomOpen(false)}
        title="누가 뭘 챙길지 뽑아볼까요?"
        description="아직 주인이 없는 준비물을 현재 참여자에게 최대한 공평하게 나눠요."
      >
        <div className="randomize-preview">
          <span>
            <ShuffleIcon aria-hidden="true" />
          </span>
          <div>
            <strong>{unassignedItems.length}개 준비물 랜덤 배정</strong>
            <small>{bundle.participants.length}명이 나눠 맡아요</small>
          </div>
        </div>
        <div className="randomize-avatars">
          {bundle.participants.map((participant) => (
            <span key={participant.id}>
              <img
                src={avatarSrc(participant.avatarKey)}
                alt=""
                draggable={false}
              />
              {participant.id === bundle.viewer?.id
                ? "나"
                : participant.name}
            </span>
          ))}
        </div>
        <button
          className="sheet-primary"
          type="button"
          disabled={busy}
          onClick={() => void handleRandomize()}
        >
          <ShuffleIcon aria-hidden="true" />
          {busy ? "나누고 있어요…" : "랜덤 담당 뽑기"}
        </button>
      </Sheet>

      <Sheet
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="준비물 편집"
        description={`선택하면 모두의 목록에 바로 반영돼요. 최대 ${maxItems}개까지 추가할 수 있어요.`}
      >
        <div className="manage-items">
          <div className="manage-items__count">
            <strong>추천 준비물</strong>
            <span>
              {bundle.items.length}/{maxItems}
            </span>
          </div>
          <ItemPicker
            options={itemOptions}
            selectedKeys={
              new Set(
                bundle.items
                  .filter((item) =>
                    itemOptions.some((option) => option.key === item.key),
                  )
                  .map((item) => item.key),
              )
            }
            disabled={busy}
            onToggle={(option) => void toggleCatalogItem(option)}
          />
          <div className="custom-item-input">
            <input
              maxLength={16}
              value={customDraft}
              aria-label="직접 준비물 입력"
              placeholder="예: 보드게임, 구급약"
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addCustomItem();
                }
              }}
            />
            <button
              type="button"
              disabled={
                busy ||
                !customDraft.trim() ||
                bundle.items.length >= maxItems
              }
              onClick={() => void addCustomItem()}
            >
              추가
            </button>
          </div>
          {bundle.items.some((item) => item.key.startsWith("custom_")) ? (
            <div className="custom-current-list">
              <strong>직접 추가한 준비물</strong>
              {bundle.items
                .filter((item) => item.key.startsWith("custom_"))
                .map((item) => (
                  <div key={item.id}>
                    <span>
                      <ItemVisual visual={item.visual} compact />
                      {item.label}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${item.label} 삭제`}
                      onClick={() => void removeCustomItem(item)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="같이 갈 친구를 불러요"
        description="링크를 연 친구가 이 모임에 참여하고 같은 준비 상태를 볼 수 있어요."
      >
        <ProgressShareCard bundle={bundle} />
        <p className="share-card-hint">
          진행 상황과 아직 주인이 없는 준비물을 함께 보내요.
        </p>
        <button
          className="sheet-primary"
          type="button"
          onClick={() => void handleShare()}
        >
          {copied ? (
            <>
              <CheckIcon aria-hidden="true" />
              공유했어요
            </>
          ) : (
            <>
              <CopyIcon aria-hidden="true" />
              초대 링크 공유하기
            </>
          )}
        </button>
      </Sheet>

      <Sheet
        open={celebrationOpen}
        onClose={() => setCelebrationOpen(false)}
        title="모두 챙겼어요!"
        description="준비물 하나도 빠짐없이 완료했어요. 친구들과 이 순간을 나눠보세요."
      >
        <div className="celebration-mark" aria-hidden="true">
          <StarFilledIcon />
          <CheckIcon />
        </div>
        <ProgressShareCard bundle={bundle} />
        <button
          className="sheet-primary"
          type="button"
          onClick={() => void handleShare()}
        >
          <CopyIcon aria-hidden="true" />
          준비 완료 자랑하기
        </button>
      </Sheet>

      <JoinSheet
        open={joinOpen && !bundle.viewer}
        outing={bundle}
        inviteCode={inviteCode ?? ""}
        onCancel={onHome}
        onJoined={(joinedSession, joinedBundle) => {
          saveSession(joinedSession, joinedBundle.outing);
          setSession(joinedSession);
          setBundle(joinedBundle);
          setJoinOpen(false);
          window.history.replaceState({}, "", `/outing/${outingId}`);
          setNotice(`${joinedBundle.viewer?.name ?? "친구"}님, 함께 준비해요`);
        }}
      />
    </main>
  );
}

function JoinSheet({
  open,
  outing,
  inviteCode,
  onCancel,
  onJoined,
}: {
  open: boolean;
  outing: OutingBundle;
  inviteCode: string;
  onCancel: () => void;
  onJoined: (session: ParticipantSession, bundle: OutingBundle) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const availableItems = outing.items
    .filter((item) => item.owner == null)
    .slice(0, 3);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const joined = await joinOuting(outing.outing.id, {
        inviteCode,
        name,
      });
      track("outing_joined", { outing_id: outing.outing.id });
      onJoined(joined.session, joined.outing);
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "모임에 참여하지 못했어요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={`${outing.outing.title}에 같이 갈까요?`}
      description={`${outing.participants.length}명이 ${outing.outing.placeName} 갈 준비를 하고 있어요.`}
    >
      <form className="create-form" onSubmit={submit}>
        {availableItems.length > 0 ? (
          <div className="join-claim-preview">
            <strong>참여하면 하나를 골라 맡을 수 있어요</strong>
            <div>
              {availableItems.map((item) => (
                <span key={item.id}>
                  <ItemVisual visual={item.visual} compact />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <label>
          <span>친구들에게 보일 이름</span>
          <input
            autoFocus
            required
            maxLength={10}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="닉네임"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="sheet-primary"
          type="submit"
          disabled={submitting}
        >
          <PersonIcon aria-hidden="true" />
          {submitting ? "참여하고 있어요…" : "모임에 참여하기"}
        </button>
      </form>
    </Sheet>
  );
}

function LoadingScreen() {
  return (
    <main className="app state-app" aria-label="모임 불러오는 중">
      <div className="skeleton skeleton-hero" />
      <div className="state-content">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" />
        <span className="loading-label">모임을 불러오고 있어요</span>
      </div>
    </main>
  );
}

function StateScreen({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <main className="app state-app">
      <div className="state-content">
        <span className="state-icon">
          <ReloadIcon aria-hidden="true" />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <button className="home-primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </main>
  );
}
