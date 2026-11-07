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
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  HeartIcon,
  MagicWandIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
  ShuffleIcon,
  StarFilledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";

import {
  addItem,
  ApiError,
  completeMyItems,
  createAiBriefing,
  deleteItem,
  deleteOuting,
  getOutingIfChanged,
  getPlaceIntelligence,
  joinOuting,
  listItemOptions,
  listPlaces,
  randomizeItems,
  resetInviteCode,
  searchSummerEvents,
  toggleEventReaction,
  updateItem,
  updateOuting,
} from "./api";
import { avatarSrc, summerTypeAvatarKey } from "./avatars";
import { AiBriefingCard } from "./components/AiBriefingCard";
import { PlaceIntelligenceCard } from "./components/PlaceIntelligenceCard";
import {
  placeArtwork,
  PlacePicker,
} from "./components/PlacePicker";
import { Sheet } from "./components/Sheet";
import {
  getSavedSummerType,
  SUMMER_TYPE_RESULTS,
} from "./components/SummerTypeTest";
import { withObject, withTopic } from "./korean";
import {
  APP_NAME,
  hasTossBridge,
  shareContent,
  track,
  type ShareOutcome,
} from "./platform";
import { getSession, removeSession, saveSession } from "./session";
import {
  addDaysToDateKey,
  daysUntil,
  formatKoreaTime,
  formatOutingDate,
  koreaDateKey,
  relativeTimeLabel,
  todayDateKey,
} from "./time";
import { getTossUserDisplayName } from "./toss-user-profile";
import type {
  ActivityOption,
  AiOutingBriefing,
  CrowdSignal,
  ItemOption,
  OutingBundle,
  OutingEvent,
  PackingItem,
  Participant,
  ParticipantSession,
  Place,
  SummerEventSearch,
} from "./types";
import {
  activityIcon,
  errorMessage,
  ItemPicker,
  ItemVisual,
  LoadingScreen,
  StateScreen,
  Toast,
  useToast,
  WeatherIcon,
} from "./ui";

const POLL_INTERVAL_MS = 10_000;
const FEED_PREVIEW_COUNT = 5;
const MAX_EXPECTED_PEOPLE = 50;

type OutingDetailTab = "packing" | "briefing" | "activity";
type PackingFilter = "all" | "open" | "mine";

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장소를 쓸 수 없는 환경에서도 화면은 계속 동작해요.
  }
}

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
          precipitationProbability: bundle.weather.precipitationProbability,
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

function isOutingPast(bundle: OutingBundle) {
  return bundle.outing.isPast ?? daysUntil(bundle.outing.startsAt) < 0;
}

function eventMessage(event: OutingEvent) {
  const name = event.participant?.name ?? "친구";
  const itemLabel = event.itemLabel ?? "준비물";
  if (event.type === "created") return `${name}님이 모임을 만들었어요`;
  if (event.type === "joined") return `${name}님이 함께 준비해요`;
  if (event.type === "claimed") {
    return `${name}님이 ${withObject(itemLabel)} 맡았어요`;
  }
  if (event.type === "unassigned") {
    return `${name}님이 ${itemLabel} 담당을 비웠어요`;
  }
  if (event.type === "completed") {
    return `${name}님이 ${itemLabel} 준비를 끝냈어요`;
  }
  if (event.type === "completed_mine") {
    return `${name}님의 준비물이 모두 끝났어요`;
  }
  if (event.type === "randomized") {
    return `${name}님이 ${event.itemLabel ?? "여러"}개를 랜덤 배정했어요`;
  }
  if (event.type === "item_added") {
    return `${name}님이 ${withObject(itemLabel)} 추가했어요`;
  }
  if (event.type === "item_deleted") {
    return `${name}님이 목록을 정리했어요`;
  }
  if (event.type === "reopened") {
    return `${name}님이 ${withObject(itemLabel)} 다시 확인해요`;
  }
  if (event.type === "updated") {
    return `${name}님이 모임 정보를 바꿨어요`;
  }
  return `${name}님이 준비 상태를 바꿨어요`;
}

function applyReaction(event: OutingEvent, type: "heart" | "cheer") {
  const reactions = { ...event.reactions };
  const previous = event.viewerReaction;
  if (previous) reactions[previous] = Math.max(0, reactions[previous] - 1);
  if (previous === type) return { ...event, reactions, viewerReaction: null };
  reactions[type] += 1;
  return { ...event, reactions, viewerReaction: type };
}

function weatherPill(bundle: OutingBundle) {
  if (bundle.weather) {
    return {
      condition: bundle.weather.condition,
      text: `${bundle.weather.maxTemperature}° · ${bundle.weather.condition} ${bundle.weather.precipitationProbability}%`,
      strong: bundle.weather.uvLabel,
    };
  }
  const place = bundle.outing.placeName;
  const status =
    bundle.weatherStatus ?? (isOutingPast(bundle) ? "past" : undefined);
  if (status === "past") {
    return { condition: null, text: `${place} · 다녀온 모임`, strong: "" };
  }
  if (status === "out_of_range") {
    return {
      condition: null,
      text: `${place} · 예보는 출발 15일 전부터 볼 수 있어요`,
      strong: "",
    };
  }
  if (status === "unavailable") {
    return {
      condition: null,
      text: `${place} · 예보를 잠시 불러오지 못했어요`,
      strong: "",
    };
  }
  return { condition: null, text: `${place} · 예보 준비 중`, strong: "" };
}

function shareResultMessage(outcome: ShareOutcome, subject: string) {
  if (outcome === "shared") return `${withObject(subject)} 공유했어요`;
  if (outcome === "copied") {
    return `${withObject(subject)} 복사했어요. 원하는 곳에 붙여넣어 주세요`;
  }
  return "";
}

function ProgressShareCard({ bundle }: { bundle: OutingBundle }) {
  const readyCount = bundle.items.filter((item) => item.done).length;
  const unassigned = bundle.items.filter((item) => item.owner == null);
  const percent =
    bundle.items.length > 0
      ? Math.round((readyCount / bundle.items.length) * 100)
      : 0;
  const day = daysUntil(bundle.outing.startsAt);
  const dayLabel = day === 0 ? "오늘" : day > 0 ? `D-${day}` : "다녀온 모임";

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

export function OutingPage({
  outingId,
  onHome,
}: {
  outingId: string;
  onHome: () => void;
}) {
  const inviteCodeRef = useRef(
    new URLSearchParams(window.location.search).get("invite"),
  );
  const [session, setSession] = useState<ParticipantSession | null>(() =>
    getSession(outingId),
  );
  const sessionRef = useRef(session);
  const [bundle, setBundle] = useState<OutingBundle | null>(null);
  const bundleRef = useRef<OutingBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [connectionIssue, setConnectionIssue] = useState(false);
  const etagRef = useRef<string | null>(null);
  const pendingCountRef = useRef(0);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResetConfirm, setInviteResetConfirm] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinPreselectItemId, setJoinPreselectItemId] = useState<
    string | null
  >(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [maxItems, setMaxItems] = useState(15);
  const [customDraft, setCustomDraft] = useState("");

  const [aiBriefing, setAiBriefing] = useState<AiOutingBriefing | null>(null);
  const [aiSnapshot, setAiSnapshot] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [crowd, setCrowd] = useState<CrowdSignal | null>(null);
  const [crowdLoading, setCrowdLoading] = useState(false);
  const [crowdError, setCrowdError] = useState("");
  const [summerEvents, setSummerEvents] = useState<SummerEventSearch | null>(
    null,
  );
  const [summerEventsLoading, setSummerEventsLoading] = useState(false);
  const [summerEventsError, setSummerEventsError] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState("");
  const [detailTab, setDetailTab] = useState<OutingDetailTab>("packing");
  const [packingFilter, setPackingFilter] = useState<PackingFilter>("all");
  const [feedExpanded, setFeedExpanded] = useState(false);
  const feedSeenKey = `chaengyeosum.feed-seen.${outingId}`;
  const [feedSeenAt, setFeedSeenAt] = useState(() => readStorage(feedSeenKey));
  const previousReadyCount = useRef<number | null>(null);
  const detailTabsRef = useRef<HTMLElement>(null);
  const packingSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const activeSession = sessionRef.current;
      try {
        const result = await getOutingIfChanged(outingId, {
          token: activeSession?.token,
          inviteCode: activeSession
            ? undefined
            : (inviteCodeRef.current ?? undefined),
          etag: force ? null : etagRef.current,
        });
        // 낙관적으로 바꾼 화면이 있는 동안에는 덮어쓰지 않고, 다음 조회에서 다시 받아요.
        if (result.changed && (force || pendingCountRef.current === 0)) {
          etagRef.current = result.etag;
          setBundle(result.bundle);
        }
        setLoadError("");
        setConnectionIssue(false);
        return true;
      } catch (refreshError) {
        const message = errorMessage(refreshError, "모임을 불러오지 못했어요.");
        const gone =
          refreshError instanceof ApiError &&
          (refreshError.status === 403 || refreshError.status === 404);
        if (!bundleRef.current || gone) {
          setLoadError(message);
        } else {
          // 이미 보고 있던 화면은 유지하고 연결 상태만 알려요.
          setConnectionIssue(true);
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [outingId],
  );

  useEffect(() => {
    void refresh({ force: true });
  }, [refresh]);

  useEffect(() => {
    listItemOptions()
      .then((result) => {
        setItemOptions(result.options);
        setActivities(result.activities);
        setMaxItems(result.maxItems);
      })
      .catch(() => {
        // 편집 시트에서만 쓰는 선택지라 실패해도 화면은 유지해요.
      });
  }, []);

  const canPoll = Boolean(session || bundle?.viewer);
  useEffect(() => {
    if (!canPoll) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [canPoll, refresh]);

  const viewerId = bundle?.viewer?.id ?? null;
  const outingStartsAt = bundle?.outing.startsAt ?? "";
  const outingPlaceId = bundle?.outing.placeId ?? "";

  const loadCrowd = useCallback(async () => {
    if (!viewerId) return;
    setCrowdLoading(true);
    setCrowdError("");
    try {
      const result = await getPlaceIntelligence(
        outingId,
        sessionRef.current?.token ?? "",
      );
      setCrowd(result.crowd);
      track("place_crowd_loaded", {
        mode: result.crowd.mode,
        level: result.crowd.level,
      });
    } catch (loadFailure) {
      setCrowdError(errorMessage(loadFailure, "혼잡도를 불러오지 못했어요."));
    } finally {
      setCrowdLoading(false);
    }
    // 모임 날짜나 장소가 바뀌면 혼잡 예측도 다시 받아요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outingId, viewerId, outingStartsAt, outingPlaceId]);

  useEffect(() => {
    void loadCrowd();
  }, [loadCrowd]);

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
      bundle.items.length > 0 &&
      nextReadyCount === bundle.items.length
    ) {
      setCelebrationOpen(true);
    }
    previousReadyCount.current = nextReadyCount;
  }, [bundle]);

  const latestEventAt = bundle?.events?.[0]?.createdAt ?? "";
  useEffect(() => {
    if (detailTab !== "activity" || !latestEventAt) return;
    if (Date.parse(latestEventAt) <= Date.parse(feedSeenAt || "0")) return;
    setFeedSeenAt(latestEventAt);
    writeStorage(feedSeenKey, latestEventAt);
  }, [detailTab, feedSeenAt, feedSeenKey, latestEventAt]);

  const setKeyPending = (key: string, pending: boolean) => {
    const next = new Set(pendingKeysRef.current);
    if (pending) next.add(key);
    else next.delete(key);
    pendingKeysRef.current = next;
    setPendingKeys(next);
  };

  /** 화면을 먼저 바꾸고 서버에 반영해요. 실패하면 서버 상태로 되돌려요. */
  const mutateOptimistically = async (
    key: string,
    optimistic: (current: OutingBundle) => OutingBundle,
    mutate: (token: string) => Promise<unknown>,
  ) => {
    if (pendingKeysRef.current.has(key)) return false;
    setKeyPending(key, true);
    pendingCountRef.current += 1;
    setBundle((current) => (current ? optimistic(current) : current));
    let succeeded = false;
    try {
      await mutate(sessionRef.current?.token ?? "");
      succeeded = true;
    } catch (mutationError) {
      showToast(errorMessage(mutationError, "변경하지 못했어요."), "error");
    } finally {
      pendingCountRef.current -= 1;
      setKeyPending(key, false);
      if (pendingCountRef.current === 0) void refresh({ force: true });
    }
    return succeeded;
  };

  const runBulk = async (mutate: (token: string) => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    pendingCountRef.current += 1;
    try {
      await mutate(sessionRef.current?.token ?? "");
      return true;
    } catch (mutationError) {
      showToast(errorMessage(mutationError, "변경하지 못했어요."), "error");
      return false;
    } finally {
      pendingCountRef.current -= 1;
      setBusy(false);
      if (pendingCountRef.current === 0) await refresh({ force: true });
    }
  };

  const updateItemLocally =
    (itemId: string, change: (item: PackingItem) => PackingItem) =>
    (current: OutingBundle) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? change(item) : item,
      ),
    });

  const openJoin = (itemId: string | null = null) => {
    setJoinPreselectItemId(itemId);
    setJoinOpen(true);
  };

  if (loading) return <LoadingScreen />;

  if (!bundle || loadError) {
    return (
      <StateScreen
        title={loadError || "모임을 찾지 못했어요."}
        description="초대 링크를 다시 확인하거나 잠시 후 다시 시도해 주세요."
        actionLabel="다시 시도"
        onAction={() => {
          setLoading(true);
          setLoadError("");
          void refresh({ force: true });
        }}
        secondaryLabel="홈으로"
        onSecondary={onHome}
      />
    );
  }

  const viewer = bundle.viewer;
  const isCreator = bundle.isCreator ?? bundle.canDelete;
  const isPast = isOutingPast(bundle);
  const maxParticipants = bundle.maxParticipants ?? 30;
  const readyCount = bundle.items.filter((item) => item.done).length;
  const readyPercent =
    bundle.items.length > 0
      ? `${Math.round((readyCount / bundle.items.length) * 100)}%`
      : "0%";
  const myItems = viewer
    ? bundle.items.filter((item) => item.owner?.id === viewer.id)
    : [];
  const myOpenItems = myItems.filter((item) => !item.done);
  const myReady = myItems.length > 0 && myOpenItems.length === 0;
  const unassignedItems = bundle.items.filter((item) => item.owner == null);
  const allReady = bundle.items.length > 0 && readyCount === bundle.items.length;
  const needsOwnItem =
    Boolean(viewer) &&
    !isPast &&
    bundle.participants.length >= 2 &&
    myItems.length === 0 &&
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
  const unreadCount = events.filter(
    (event) =>
      event.participant?.id !== viewer?.id &&
      Date.parse(event.createdAt) > Date.parse(feedSeenAt || "0"),
  ).length;
  const visibleEvents = feedExpanded
    ? events
    : events.slice(0, FEED_PREVIEW_COUNT);
  const visibleItems =
    packingFilter === "open"
      ? bundle.items.filter((item) => !item.done)
      : packingFilter === "mine"
        ? myItems
        : bundle.items;
  const selectedItem =
    bundle.items.find((item) => item.id === selectedItemId) ?? null;
  const pill = weatherPill(bundle);
  const pastReason = isPast ? "이미 지난 모임이라 새로 분석하지 않아요." : "";
  const canManageItem = (item: PackingItem) =>
    !item.owner || item.owner.id === viewer?.id || isCreator;
  const canShowRandomize =
    Boolean(viewer) &&
    !isPast &&
    bundle.participants.length > 1 &&
    unassignedItems.length > 0;

  const assign = async (participant: Participant) => {
    if (!selectedItem) return;
    const item = selectedItem;
    setSelectedItemId(null);
    if (item.owner?.id === participant.id) return;
    const changed = await mutateOptimistically(
      `item:${item.id}`,
      updateItemLocally(item.id, (current) => ({
        ...current,
        owner: participant,
        done: false,
      })),
      (token) =>
        updateItem(outingId, item.id, token, { ownerId: participant.id }),
    );
    if (!changed) return;
    track("packing_item_assigned", { item_id: item.key });
    showToast(
      participant.id === viewer?.id
        ? `${withObject(item.label)} 내가 챙길게요`
        : `${participant.name}님이 ${withObject(item.label)} 맡았어요`,
    );
  };

  const unassign = async (item: PackingItem) => {
    setSelectedItemId(null);
    const changed = await mutateOptimistically(
      `item:${item.id}`,
      updateItemLocally(item.id, (current) => ({
        ...current,
        owner: null,
        done: false,
      })),
      (token) => updateItem(outingId, item.id, token, { ownerId: null }),
    );
    if (!changed) return;
    track("packing_item_unassigned", { item_id: item.key });
    showToast(`${item.label} 담당을 비웠어요`, "info");
  };

  const toggle = (item: PackingItem) => {
    if (!viewer) {
      openJoin(item.owner ? null : item.id);
      return;
    }
    if (!canManageItem(item)) {
      showToast(
        `${item.owner?.name ?? "친구"}님이 챙기는 준비물이에요`,
        "info",
      );
      return;
    }
    void mutateOptimistically(
      `item:${item.id}`,
      updateItemLocally(item.id, (current) => ({
        ...current,
        done: !current.done,
      })),
      (token) => updateItem(outingId, item.id, token, { done: !item.done }),
    );
    track("packing_item_toggled", { item_id: item.key });
  };

  const claimForMe = async (item: PackingItem, closeAfter = false) => {
    if (!viewer) {
      openJoin(item.id);
      return;
    }
    if (closeAfter) setClaimOpen(false);
    const changed = await mutateOptimistically(
      `item:${item.id}`,
      updateItemLocally(item.id, (current) => ({
        ...current,
        owner: viewer,
        done: false,
      })),
      (token) => updateItem(outingId, item.id, token, { ownerId: viewer.id }),
    );
    if (!changed) return;
    showToast(`${item.label}, 내가 챙길게요!`);
    track("packing_item_self_claimed", { item_id: item.key });
  };

  const handleOwnerClick = (item: PackingItem) => {
    if (!viewer) {
      openJoin(item.owner ? null : item.id);
      return;
    }
    if (!item.owner) {
      void claimForMe(item);
      return;
    }
    if (item.owner.id === viewer.id || isCreator) {
      setSelectedItemId(item.id);
      return;
    }
    showToast(`${item.owner.name}님이 챙기고 있어요`, "info");
  };

  const finishMine = async () => {
    if (!viewer || myOpenItems.length === 0) return;
    const openIds = new Set(myOpenItems.map((item) => item.id));
    const changed = await mutateOptimistically(
      "complete-mine",
      (current) => ({
        ...current,
        items: current.items.map((item) =>
          openIds.has(item.id) ? { ...item, done: true } : item,
        ),
      }),
      (token) => completeMyItems(outingId, token),
    );
    if (!changed) return;
    showToast(`${viewer.name}님의 준비물을 모두 완료했어요`);
    track("my_packing_completed");
  };

  const toggleCatalogItem = async (option: ItemOption) => {
    const existing = bundle.items.find((item) => item.key === option.key);
    if (existing && !canManageItem(existing)) {
      showToast(
        `${existing.owner?.name ?? "친구"}님이 맡은 준비물은 빼지 못해요`,
        "info",
      );
      return;
    }
    const changed = await runBulk((token) =>
      existing
        ? deleteItem(outingId, existing.id, token)
        : addItem(outingId, token, { optionKey: option.key }),
    );
    if (!changed) return;
    showToast(
      existing
        ? `${withObject(option.label)} 목록에서 뺐어요`
        : `${withObject(option.label)} 함께 챙겨요`,
    );
    track(existing ? "packing_item_deleted" : "packing_item_added", {
      item_id: option.key,
    });
  };

  const addCustomItem = async () => {
    const label = customDraft.trim().replace(/\s+/g, " ").slice(0, 16);
    if (!label) return;
    const changed = await runBulk((token) =>
      addItem(outingId, token, { label }),
    );
    if (!changed) return;
    setCustomDraft("");
    showToast(`${withObject(label)} 함께 챙겨요`);
    track("custom_packing_item_added");
  };

  const removeCustomItem = async (item: PackingItem) => {
    if (!canManageItem(item)) {
      showToast(
        `${item.owner?.name ?? "친구"}님이 맡은 준비물은 빼지 못해요`,
        "info",
      );
      return;
    }
    const changed = await runBulk((token) =>
      deleteItem(outingId, item.id, token),
    );
    if (!changed) return;
    showToast(`${withObject(item.label)} 목록에서 뺐어요`);
    track("packing_item_deleted", { item_id: "custom" });
  };

  const applySmartRecommendations = async () => {
    const availableSlots = Math.max(0, maxItems - bundle.items.length);
    const missing = missingSmartRecommendations.slice(0, availableSlots);
    if (missing.length === 0) {
      showToast(
        availableSlots === 0
          ? `준비물은 최대 ${maxItems}개까지 담을 수 있어요`
          : "추천 준비물이 모두 목록에 있어요",
        "info",
      );
      return;
    }
    let added = 0;
    const changed = await runBulk(async (token) => {
      for (const recommendation of missing) {
        await addItem(outingId, token, { optionKey: recommendation.key });
        added += 1;
      }
    });
    if (added > 0 && changed) {
      showToast(`날씨 맞춤 준비물 ${added}개를 더했어요`);
      track("smart_packing_applied", { item_count: added });
    }
  };

  const handleRandomize = async () => {
    const changed = await runBulk((token) => randomizeItems(outingId, token));
    if (!changed) return;
    setRandomOpen(false);
    showToast("남은 준비물을 공평하게 나눴어요");
    track("packing_items_randomized");
  };

  const reactToEvent = (event: OutingEvent, reactionType: "heart" | "cheer") => {
    if (!viewer) return;
    void mutateOptimistically(
      `event:${event.id}`,
      (current) => ({
        ...current,
        events: current.events.map((candidate) =>
          candidate.id === event.id
            ? applyReaction(candidate, reactionType)
            : candidate,
        ),
      }),
      (token) => toggleEventReaction(outingId, event.id, token, reactionType),
    ).then((changed) => {
      if (changed) {
        track("activity_event_reacted", { reaction_type: reactionType });
      }
    });
  };

  const handleAiGenerate = async () => {
    if (!viewer || aiLoading || isPast) return;
    setAiLoading(true);
    setAiError("");
    track("ai_briefing_requested", { outing_id: outingId });
    try {
      const snapshot = getBriefingSnapshot(bundle);
      const result = await createAiBriefing(
        outingId,
        sessionRef.current?.token ?? "",
      );
      setAiBriefing(result.briefing);
      setAiSnapshot(snapshot);
      track("ai_briefing_generated", {
        outing_id: outingId,
        cached: result.meta.cached ? 1 : 0,
      });
    } catch (generationError) {
      setAiError(errorMessage(generationError, "AI 브리핑을 만들지 못했어요."));
      track("ai_briefing_failed", { outing_id: outingId });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSummerEventSearch = async () => {
    if (!viewer || summerEventsLoading || isPast) return;
    setSummerEventsLoading(true);
    setSummerEventsError("");
    track("summer_events_requested", { outing_id: outingId });
    try {
      const result = await searchSummerEvents(
        outingId,
        sessionRef.current?.token ?? "",
      );
      setSummerEvents(result.events);
      track("summer_events_loaded", {
        outing_id: outingId,
        event_count: result.events.events.length,
        cached: result.meta.cached ? 1 : 0,
      });
    } catch (searchError) {
      setSummerEventsError(
        errorMessage(searchError, "행사 정보를 확인하지 못했어요."),
      );
      track("summer_events_failed", { outing_id: outingId });
    } finally {
      setSummerEventsLoading(false);
    }
  };

  const switchDetailTab = (tab: OutingDetailTab) => {
    if (tab === detailTab) return;
    setDetailTab(tab);
    track("outing_detail_tab_selected", { tab });
    window.requestAnimationFrame(() => {
      detailTabsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const focusItem = (itemId: string) => {
    setHighlightedItemId(itemId);
    setPackingFilter("all");
    setDetailTab("packing");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`packing-item-${itemId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  };

  const focusAiItem = (itemKey: string) => {
    const item = bundle.items.find((candidate) => candidate.key === itemKey);
    if (!item) return;
    focusItem(item.id);
    track("ai_briefing_action_opened", { item_id: item.key });
  };

  const showOpenItems = () => {
    setPackingFilter("open");
    setDetailTab("packing");
    window.requestAnimationFrame(() => {
      packingSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    track("last_check_opened", { outing_id: outingId });
  };

  const buildInviteLinks = () => {
    const query = `?invite=${encodeURIComponent(bundle.outing.inviteCode)}`;
    return {
      deepLink: `intoss://${APP_NAME}/outing/${bundle.outing.id}${query}`,
      webLink: `${window.location.origin}/outing/${bundle.outing.id}${query}`,
    };
  };

  const handleAiShare = async () => {
    if (!aiBriefing) return;
    const message = [
      `☀️ ${viewer ? `${viewer.name}님이 보낸 ` : ""}${bundle.outing.title} AI 준비 브리핑`,
      `“${aiBriefing.headline}”`,
      aiBriefing.shareCaption,
      "같이 확인하고 하나씩 맡아줘 👇",
    ].join("\n");
    const outcome = await shareContent({
      title: `${bundle.outing.title} AI 브리핑`,
      message,
      ...buildInviteLinks(),
    });
    track("ai_briefing_shared", { outing_id: outingId, outcome });
    if (outcome === "failed") {
      showToast("공유하지 못했어요. 다시 시도해 주세요.", "error");
    } else if (outcome !== "cancelled") {
      showToast(shareResultMessage(outcome, "AI 브리핑"));
    }
  };

  const handleShare = async () => {
    const day = daysUntil(bundle.outing.startsAt);
    const dayLabel = day === 0 ? "오늘" : day > 0 ? `D-${day}` : "";
    const ask =
      unassignedItems.length > 0
        ? `${unassignedItems
            .slice(0, 3)
            .map((item) => item.label)
            .join(" · ")} 중 하나 맡아줄래?`
        : allReady
          ? "준비물 하나도 빠짐없이 다 챙겼어요!"
          : "준비 상황 같이 확인해줘!";
    const message = [
      `🏖️ ${viewer ? `${viewer.name}님이 초대했어요` : bundle.outing.title}`,
      ...(viewer ? [`${bundle.outing.title}, 같이 챙길래?`] : []),
      `${dayLabel ? `${dayLabel} · ` : ""}준비 ${readyCount}/${bundle.items.length}`,
      ask,
      "하나 맡고 준비 완료까지 같이 가요 👇",
    ].join("\n");
    const outcome = await shareContent({
      title: `${bundle.outing.title} 같이 챙겨요`,
      message,
      ...buildInviteLinks(),
    });
    track("outing_invite_shared", { outing_id: outingId, outcome });
    if (outcome === "failed") {
      showToast("공유하지 못했어요. 다시 시도해 주세요.", "error");
      return;
    }
    if (outcome === "cancelled") return;
    setShareDone(true);
    showToast(shareResultMessage(outcome, "초대 링크"));
  };

  const handleResetInvite = async () => {
    const changed = await runBulk(async (token) => {
      const result = await resetInviteCode(outingId, token);
      setBundle((current) =>
        current
          ? {
              ...current,
              outing: { ...current.outing, inviteCode: result.inviteCode },
            }
          : current,
      );
    });
    if (!changed) return;
    setInviteResetConfirm(false);
    setShareDone(false);
    showToast("새 초대 링크를 만들었어요. 이전 링크로는 참여할 수 없어요");
    track("outing_invite_reset", { outing_id: outingId });
  };

  const openInvite = () => {
    setShareDone(false);
    setInviteResetConfirm(false);
    setInviteOpen(true);
  };

  type DockAction = {
    label: string;
    onClick: () => void;
    tone?: "complete";
    disabled?: boolean;
  };
  let primaryAction: DockAction | null = null;
  let secondaryAction: DockAction | null = null;
  if (viewer) {
    const shareProgress: DockAction = {
      label: "진행률 공유하기",
      onClick: openInvite,
    };
    if (isPast) {
      primaryAction = { label: "준비 기록 공유하기", onClick: openInvite };
    } else if (allReady) {
      primaryAction = {
        label: "준비 완료 자랑하기",
        onClick: openInvite,
        tone: "complete",
      };
    } else if (bundle.participants.length === 1) {
      primaryAction = { label: "친구 초대하기", onClick: openInvite };
      secondaryAction =
        myOpenItems.length > 0
          ? {
              label: `내 준비 끝내기 · ${myOpenItems.length}개`,
              onClick: () => void finishMine(),
            }
          : null;
    } else if (myItems.length === 0 && unassignedItems.length > 0) {
      primaryAction = {
        label: "준비물 하나 맡기",
        onClick: () => setClaimOpen(true),
      };
      secondaryAction = shareProgress;
    } else if (myOpenItems.length > 0) {
      primaryAction = {
        label: `내 준비 끝내기 · ${myOpenItems.length}개 남음`,
        onClick: () => void finishMine(),
        disabled: pendingKeys.has("complete-mine"),
      };
      secondaryAction = shareProgress;
    } else {
      primaryAction = {
        label: myReady ? "내 준비 완료 · 진행률 공유하기" : "진행률 공유하기",
        onClick: openInvite,
        tone: myReady ? "complete" : undefined,
      };
      secondaryAction =
        unassignedItems.length > 0
          ? { label: "준비물 하나 더 맡기", onClick: () => setClaimOpen(true) }
          : null;
    }
  }

  return (
    <main
      className="app outing-app"
      aria-label={`${bundle.outing.title} 준비 화면`}
    >
      {connectionIssue ? (
        <div className="connection-banner" role="status">
          <span>연결이 불안정해요. 마지막으로 받은 내용을 보여주고 있어요.</span>
          <button type="button" onClick={() => void refresh({ force: true })}>
            <ReloadIcon aria-hidden="true" />
            다시 연결
          </button>
        </div>
      ) : null}

      <section className="hero hero--place" aria-labelledby="outing-title">
        <img
          className="hero-image"
          src={placeArtwork(
            bundle.outing.placeImageUrl,
            bundle.outing.placeCategory,
          )}
          alt=""
          draggable={false}
        />
        <div className="hero-topbar">
          {!hasTossBridge() ? (
            <button
              className="hero-icon-button"
              type="button"
              aria-label="홈으로"
              onClick={onHome}
            >
              <ChevronLeftIcon aria-hidden="true" />
            </button>
          ) : (
            <span />
          )}
          {isCreator ? (
            <button
              className="hero-icon-button hero-icon-button--label"
              type="button"
              onClick={() => setEditOpen(true)}
            >
              <Pencil1Icon aria-hidden="true" />
              모임 수정
            </button>
          ) : null}
        </div>
        <div className="hero-content">
          <p className="outing-date">
            {formatOutingDate(bundle.outing.startsAt)}
          </p>
          <h1 id="outing-title">
            {bundle.outing.title},
            <br />
            {isPast
              ? `${bundle.participants.length}명이 함께했어요`
              : `${bundle.participants.length}명이 준비 중`}
          </h1>
          <div className="weather-pill" aria-label="모임 날씨">
            <WeatherIcon condition={pill.condition} />
            <span>{pill.text}</span>
            {pill.strong ? <strong>{pill.strong}</strong> : null}
          </div>
        </div>
      </section>

      {!viewer && inviteCodeRef.current ? (
        <section
          className="invite-entry-card"
          aria-labelledby="invite-entry-title"
        >
          <div>
            <span>초대받은 모임이에요</span>
            <h2 id="invite-entry-title">친구들과 준비물을 나눠 맡아보세요</h2>
            <p>이름을 정하고 내가 챙길 준비물을 하나 골라요.</p>
          </div>
          <button type="button" onClick={() => openJoin()}>
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

      <nav
        ref={detailTabsRef}
        className="outing-detail-tabs"
        aria-label="모임 상세 메뉴"
      >
        <button
          className={detailTab === "packing" ? "is-active" : ""}
          type="button"
          aria-pressed={detailTab === "packing"}
          onClick={() => switchDetailTab("packing")}
        >
          <BackpackIcon aria-hidden="true" />
          <span>준비물</span>
          {unfinishedCount > 0 ? <small>{unfinishedCount}</small> : null}
        </button>
        <button
          className={detailTab === "briefing" ? "is-active" : ""}
          type="button"
          aria-pressed={detailTab === "briefing"}
          onClick={() => switchDetailTab("briefing")}
        >
          <MagicWandIcon aria-hidden="true" />
          <span>장소·AI</span>
        </button>
        <button
          className={detailTab === "activity" ? "is-active" : ""}
          type="button"
          aria-pressed={detailTab === "activity"}
          aria-label={
            unreadCount > 0 ? `친구 소식, 새 소식 ${unreadCount}개` : undefined
          }
          onClick={() => switchDetailTab("activity")}
        >
          <PersonIcon aria-hidden="true" />
          <span>친구 소식</span>
          {unreadCount > 0 ? (
            <small className="is-new">
              {unreadCount > 9 ? "9+" : unreadCount}
            </small>
          ) : null}
        </button>
      </nav>

      <div className="outing-detail-panel" hidden={detailTab !== "packing"}>
        {isPast ? (
          <section className="past-outing-card">
            <CalendarIcon aria-hidden="true" />
            <span>
              <strong>다녀온 모임이에요</strong>
              <small>준비 기록과 친구 소식을 그대로 볼 수 있어요.</small>
            </span>
          </section>
        ) : null}

        {viewer &&
        !isPast &&
        unassignedItems.length > 0 &&
        bundle.participants.length < maxParticipants ? (
          <button className="invite-nudge" type="button" onClick={openInvite}>
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

        {eventDay >= 0 && eventDay <= 1 && unfinishedCount > 0 ? (
          <button
            className="last-check-card"
            type="button"
            onClick={showOpenItems}
          >
            <CalendarIcon aria-hidden="true" />
            <span>
              <strong>
                {eventDay === 0 ? "오늘 출발해요" : "내일 출발해요"}
              </strong>
              <small>아직 {unfinishedCount}개가 준비 중이에요</small>
            </span>
            <b>
              남은 것 보기
              <ChevronRightIcon aria-hidden="true" />
            </b>
          </button>
        ) : null}

        {viewer && !isPast ? (
          missingSmartRecommendations.length > 0 ? (
            <section
              className="smart-packing-card"
              aria-labelledby="smart-title"
            >
              <div className="smart-packing-card__heading">
                <span>
                  <MagicWandIcon aria-hidden="true" />
                </span>
                <div>
                  <p>SMART PACKING</p>
                  <h2 id="smart-title">
                    {bundle.weather
                      ? "이 날씨엔 이렇게 챙겨요"
                      : "이 모임엔 이렇게 챙겨요"}
                  </h2>
                </div>
              </div>
              <div className="smart-recommendation-list">
                {missingSmartRecommendations.slice(0, 3).map((recommendation) => (
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void applySmartRecommendations()}
                >
                  추천 {missingSmartRecommendations.length}개 반영
                </button>
                {canShowRandomize ? (
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
          ) : (
            <section className="smart-packing-compact" aria-label="맞춤 준비물">
              <span>
                <CheckIcon aria-hidden="true" />
                {bundle.weather
                  ? "날씨 맞춤 준비물 반영 완료"
                  : bundle.weatherStatus === "out_of_range"
                    ? "활동 맞춤 준비물 반영 완료 · 날씨는 15일 전부터 반영돼요"
                    : "맞춤 준비물 반영 완료"}
              </span>
              {canShowRandomize ? (
                <button
                  className="randomize-open"
                  type="button"
                  onClick={() => setRandomOpen(true)}
                >
                  <ShuffleIcon aria-hidden="true" />
                  랜덤으로 나누기
                </button>
              ) : null}
            </section>
          )
        ) : null}

        <section
          ref={packingSectionRef}
          className="packing-section"
          aria-labelledby="packing-title"
        >
          <div className="packing-title-row">
            <h2 id="packing-title">함께 챙길 것</h2>
            <div className="packing-title-actions">
              {viewer && !isPast ? (
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
          <div className="packing-filter" role="group" aria-label="준비물 보기">
            {(
              [
                ["all", `전체 ${bundle.items.length}`],
                ["open", `남은 것 ${unfinishedCount}`],
                ...(viewer
                  ? ([["mine", `내 담당 ${myItems.length}`]] as const)
                  : []),
              ] as const
            ).map(([key, label]) => (
              <button
                className={packingFilter === key ? "is-active" : ""}
                type="button"
                aria-pressed={packingFilter === key}
                key={key}
                onClick={() => setPackingFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="packing-list">
            {visibleItems.length === 0 ? (
              <p className="packing-list__empty">
                {packingFilter === "open"
                  ? "남은 준비물이 없어요. 모두 챙겼어요!"
                  : "내가 맡은 준비물이 아직 없어요."}
              </p>
            ) : null}
            {visibleItems.map((item) => {
              const pending =
                pendingKeys.has(`item:${item.id}`) ||
                pendingKeys.has("complete-mine");
              const manageable = !viewer || canManageItem(item);
              return (
                <article
                  id={`packing-item-${item.id}`}
                  className={`packing-row${item.done ? " is-done" : ""}${
                    highlightedItemId === item.id ? " is-ai-target" : ""
                  }${pending ? " is-pending" : ""}`}
                  key={item.id}
                >
                  <button
                    className={`check-button${manageable ? "" : " is-locked"}`}
                    type="button"
                    aria-label={`${item.label} ${
                      item.done ? "준비 취소" : "준비 완료"
                    }`}
                    aria-pressed={item.done}
                    disabled={pending || busy}
                    onClick={() => toggle(item)}
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
                    disabled={pending || busy || (isPast && !item.owner)}
                    aria-label={
                      item.owner
                        ? `${item.label} 담당자 ${
                            item.owner.id === viewer?.id
                              ? "나"
                              : item.owner.name
                          }`
                        : `${item.label} 내가 맡기`
                    }
                    onClick={() => handleOwnerClick(item)}
                  >
                    {item.owner ? (
                      <>
                        <img
                          src={avatarSrc(item.owner.avatarKey)}
                          alt=""
                          draggable={false}
                        />
                        <span>
                          {item.owner.id === viewer?.id
                            ? "나"
                            : item.owner.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <PlusIcon aria-hidden="true" />
                        <span>맡기</span>
                      </>
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <div className="outing-detail-panel" hidden={detailTab !== "briefing"}>
        {viewer ? (
          <AiBriefingCard
            briefing={aiBriefing}
            loading={aiLoading}
            error={aiError}
            stale={aiBriefingStale}
            disabledReason={pastReason}
            onGenerate={() => void handleAiGenerate()}
            onShare={() => void handleAiShare()}
            onFocusItem={focusAiItem}
          />
        ) : null}

        {viewer ? (
          <PlaceIntelligenceCard
            placeName={bundle.outing.placeName}
            crowd={crowd}
            crowdLoading={crowdLoading}
            crowdError={crowdError}
            events={summerEvents}
            eventLoading={summerEventsLoading}
            eventError={summerEventsError}
            eventsDisabledReason={pastReason}
            onRefreshCrowd={() => void loadCrowd()}
            onSearchEvents={() => void handleSummerEventSearch()}
          />
        ) : (
          <section className="outing-tab-empty">
            <MagicWandIcon aria-hidden="true" />
            <strong>참여하면 장소 브리핑을 볼 수 있어요</strong>
            <span>혼잡도와 여름 행사, AI 준비 팁을 한곳에 모아드려요.</span>
          </section>
        )}
      </div>

      <div className="outing-detail-panel" hidden={detailTab !== "activity"}>
        <section
          className="outing-participants-card"
          aria-labelledby="participants-title"
        >
          <div className="outing-participants-card__heading">
            <span>
              <strong id="participants-title">함께 준비하는 친구</strong>
              <small>
                {bundle.participants.length}명 참여 중 · 최대 {maxParticipants}명
              </small>
            </span>
            {viewer && !isPast ? (
              <button type="button" onClick={openInvite}>
                <PlusIcon aria-hidden="true" />
                초대
              </button>
            ) : null}
          </div>
          <ul>
            {bundle.participants.slice(0, 6).map((participant, index) => {
              const participantItems = bundle.items.filter(
                (item) => item.owner?.id === participant.id,
              );
              const participantReady = participantItems.filter(
                (item) => item.done,
              ).length;
              return (
                <li key={participant.id}>
                  <img
                    src={avatarSrc(participant.avatarKey)}
                    alt=""
                    draggable={false}
                  />
                  <span>
                    <strong>
                      {participant.id === viewer?.id
                        ? `${participant.name} · 나`
                        : participant.name}
                      {index === 0 ? <em>모임장</em> : null}
                    </strong>
                    <small>
                      {participantItems.length > 0
                        ? `${participantReady}/${participantItems.length}개 준비`
                        : "아직 맡은 준비물이 없어요"}
                    </small>
                  </span>
                  <b
                    className={
                      participantItems.length > 0 &&
                      participantReady === participantItems.length
                        ? "is-ready"
                        : ""
                    }
                  >
                    {participantItems.length === 0
                      ? "대기"
                      : participantReady === participantItems.length
                        ? "완료"
                        : `${participantItems.length - participantReady}개 남음`}
                  </b>
                </li>
              );
            })}
          </ul>
          {bundle.participants.length > 6 ? (
            <p className="outing-participants-card__more">
              외 {bundle.participants.length - 6}명도 함께 준비하고 있어요
            </p>
          ) : null}
        </section>

        {events.length > 0 ? (
          <section className="activity-feed" aria-labelledby="activity-title">
            <div>
              <h2 id="activity-title">친구들 소식</h2>
              <span>10초마다 갱신</span>
            </div>
            <ul>
              {visibleEvents.map((event) => {
                const eventPending = pendingKeys.has(`event:${event.id}`);
                return (
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
                      <p>
                        {eventMessage(event)}
                        <time dateTime={event.createdAt}>
                          {relativeTimeLabel(event.createdAt)}
                        </time>
                      </p>
                      {viewer ? (
                        <div className="activity-reactions">
                          {(["heart", "cheer"] as const).map((type) => {
                            const count = event.reactions?.[type] ?? 0;
                            return (
                              <button
                                className={count > 0 ? "has-count" : ""}
                                type="button"
                                key={type}
                                aria-label={`${
                                  type === "heart" ? "좋아요" : "응원해요"
                                }${count > 0 ? ` ${count}개` : ""}`}
                                aria-pressed={event.viewerReaction === type}
                                disabled={eventPending}
                                onClick={() => reactToEvent(event, type)}
                              >
                                {type === "heart" ? (
                                  <HeartIcon aria-hidden="true" />
                                ) : (
                                  <StarFilledIcon aria-hidden="true" />
                                )}
                                {count > 0 ? count : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {events.length > FEED_PREVIEW_COUNT ? (
              <button
                className="activity-feed__more"
                type="button"
                onClick={() => setFeedExpanded((current) => !current)}
              >
                {feedExpanded
                  ? "접기"
                  : `소식 ${events.length - FEED_PREVIEW_COUNT}개 더 보기`}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="outing-tab-empty">
            <HeartIcon aria-hidden="true" />
            <strong>아직 새로운 소식이 없어요</strong>
            <span>친구가 참여하거나 준비물을 맡으면 여기에 보여요.</span>
          </section>
        )}
      </div>

      {viewer && primaryAction ? (
        <div className="action-dock" aria-label="준비 작업">
          <button
            className={`primary-action${
              primaryAction.tone === "complete" ? " is-complete" : ""
            }`}
            type="button"
            disabled={busy || primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </button>
          {secondaryAction ? (
            <button
              className="secondary-action"
              type="button"
              disabled={busy || secondaryAction.disabled}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {!viewer && inviteCodeRef.current ? (
        <div className="action-dock" aria-label="참여">
          <button
            className="primary-action"
            type="button"
            onClick={() => openJoin()}
          >
            모임 참여하고 하나 맡기
          </button>
        </div>
      ) : null}

      <Toast toast={toast} />

      <Sheet
        open={claimOpen && unassignedItems.length > 0}
        onClose={() => setClaimOpen(false)}
        title="하나만 맡아볼까요?"
        description={`아직 주인이 없는 준비물이 ${unassignedItems.length}개예요. 내가 챙길 것을 하나 골라주세요.`}
      >
        <div className="claim-items">
          {unassignedItems.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={pendingKeys.has(`item:${item.id}`)}
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
          onClick={() => setClaimOpen(false)}
        >
          나중에 고를게요
        </button>
      </Sheet>

      <Sheet
        open={selectedItem != null}
        onClose={() => setSelectedItemId(null)}
        title={`${withTopic(selectedItem?.label ?? "준비물")} 누가 챙길까요?`}
        description={
          isCreator
            ? "모임장은 담당자를 바꿀 수 있어요. 친구들에게도 바로 반영돼요."
            : "내가 맡은 준비물을 다른 친구에게 넘기거나 비울 수 있어요."
        }
      >
        <div className="people-grid">
          {bundle.participants.map((participant) => {
            const current = selectedItem?.owner?.id === participant.id;
            return (
              <button
                className={current ? "is-current" : ""}
                key={participant.id}
                type="button"
                aria-pressed={current}
                onClick={() => void assign(participant)}
              >
                <img
                  src={avatarSrc(participant.avatarKey)}
                  alt=""
                  draggable={false}
                />
                <span>
                  {participant.id === viewer?.id ? "나" : participant.name}
                </span>
                {current ? <small>지금 담당</small> : null}
              </button>
            );
          })}
        </div>
        {selectedItem?.owner ? (
          <button
            className="sheet-text-button sheet-text-button--danger"
            type="button"
            onClick={() => selectedItem && void unassign(selectedItem)}
          >
            담당 비우기
          </button>
        ) : null}
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
              {participant.id === viewer?.id ? "나" : participant.name}
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
        description={`선택하면 모두의 목록에 바로 반영돼요. 최대 ${maxItems}개까지 담을 수 있어요.`}
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
                busy || !customDraft.trim() || bundle.items.length >= maxItems
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
        title={isPast ? "준비 기록을 나눠요" : "같이 갈 친구를 불러요"}
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
          {shareDone ? (
            <>
              <CheckIcon aria-hidden="true" />
              한 번 더 공유하기
            </>
          ) : (
            <>
              <CopyIcon aria-hidden="true" />
              초대 링크 공유하기
            </>
          )}
        </button>
        {isCreator && !isPast ? (
          inviteResetConfirm ? (
            <div className="invite-reset-confirm" role="alert">
              <p>
                새 링크를 만들면 이전 초대 링크로는 더 이상 참여할 수 없어요.
                이미 참여한 친구는 그대로예요.
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => setInviteResetConfirm(false)}
                >
                  취소
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResetInvite()}
                >
                  새 링크 만들기
                </button>
              </div>
            </div>
          ) : (
            <button
              className="sheet-text-button"
              type="button"
              onClick={() => setInviteResetConfirm(true)}
            >
              링크가 원치 않는 곳에 퍼졌나요? 초대 링크 새로 만들기
            </button>
          )
        ) : null}
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
        open={joinOpen && !viewer}
        bundle={bundle}
        inviteCode={inviteCodeRef.current ?? ""}
        preselectItemId={joinPreselectItemId}
        onClose={() => setJoinOpen(false)}
        onJoined={async (joinedSession, joinedBundle, claim) => {
          saveSession(joinedSession, joinedBundle.outing);
          sessionRef.current = joinedSession;
          setSession(joinedSession);
          etagRef.current = null;
          setBundle(joinedBundle);
          setJoinOpen(false);
          inviteCodeRef.current = null;
          window.history.replaceState({}, "", `/outing/${outingId}`);
          const name = joinedBundle.viewer?.name ?? "친구";
          if (claim?.result === "claimed") {
            showToast(`${name}님, ${withObject(claim.label)} 맡았어요`);
          } else if (claim?.result === "taken") {
            showToast(
              `아쉽게도 ${withTopic(claim.label)} 이미 다른 친구가 맡았어요`,
              "info",
            );
          } else {
            showToast(`${name}님, 함께 준비해요`);
          }
          await refresh({ force: true });
        }}
      />

      {isCreator ? (
        <OutingEditSheet
          open={editOpen}
          bundle={bundle}
          activities={activities}
          onClose={() => setEditOpen(false)}
          onSaved={(nextBundle) => {
            etagRef.current = null;
            setBundle(nextBundle);
            if (sessionRef.current) {
              saveSession(sessionRef.current, nextBundle.outing);
            }
            setEditOpen(false);
            setAiBriefing(null);
            setSummerEvents(null);
            showToast("모임 정보를 바꿨어요");
            track("outing_updated", { outing_id: outingId });
          }}
          onDeleted={() => {
            removeSession(outingId);
            track("outing_deleted", { outing_id: outingId });
            onHome();
          }}
          getToken={() => sessionRef.current?.token ?? ""}
        />
      ) : null}
    </main>
  );
}

function JoinSheet({
  open,
  bundle,
  inviteCode,
  preselectItemId,
  onClose,
  onJoined,
}: {
  open: boolean;
  bundle: OutingBundle;
  inviteCode: string;
  preselectItemId: string | null;
  onClose: () => void;
  onJoined: (
    session: ParticipantSession,
    bundle: OutingBundle,
    claim: { result: "claimed" | "taken"; label: string } | null,
  ) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [claimItemId, setClaimItemId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const savedType = useMemo(() => (open ? getSavedSummerType() : null), [open]);
  const availableItems = bundle.items.filter((item) => item.owner == null);
  const isFull =
    bundle.participants.length >= (bundle.maxParticipants ?? 30);
  const claimItem =
    availableItems.find((item) => item.id === claimItemId) ?? null;

  useEffect(() => {
    if (!open) return;
    setError("");
    setClaimItemId(preselectItemId);
    let cancelled = false;
    void getTossUserDisplayName().then((displayName) => {
      if (!cancelled && displayName) {
        setName((current) => (current.trim() ? current : displayName));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, preselectItemId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("친구들이 알아볼 수 있도록 이름을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const joined = await joinOuting(bundle.outing.id, {
        inviteCode,
        name: name.trim(),
        avatarKey: summerTypeAvatarKey(savedType),
        claimItemId: claimItem?.id,
      });
      track("outing_joined", {
        outing_id: bundle.outing.id,
        with_claim: claimItem ? 1 : 0,
      });
      let claim: { result: "claimed" | "taken"; label: string } | null = null;
      if (claimItem) {
        let result = joined.claimResult;
        // 예전 서버처럼 claimItemId를 모르면 참여 직후 직접 맡아요.
        if (result == null) {
          try {
            await updateItem(
              bundle.outing.id,
              claimItem.id,
              joined.session.token,
              { ownerId: joined.session.participantId },
            );
            result = "claimed";
          } catch {
            result = "taken";
          }
        }
        if (result === "claimed" || result === "taken") {
          claim = { result, label: claimItem.label };
        }
      }
      await onJoined(joined.session, joined.outing, claim);
    } catch (joinError) {
      setError(errorMessage(joinError, "모임에 참여하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${bundle.outing.title}에 같이 갈까요?`}
      description={`${bundle.participants.length}명이 ${bundle.outing.placeName} 갈 준비를 하고 있어요.`}
    >
      <form className="create-form join-form" onSubmit={submit}>
        {isFull ? (
          <p className="form-error">
            모임 인원이 가득 찼어요. 모임장에게 문의해 주세요.
          </p>
        ) : null}
        <label>
          <span>친구들에게 보일 이름</span>
          <input
            autoFocus={!preselectItemId}
            required
            maxLength={10}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="닉네임"
          />
        </label>
        {savedType ? (
          <div className="join-avatar-preview">
            <img
              src={SUMMER_TYPE_RESULTS[savedType].image}
              alt=""
              draggable={false}
            />
            <span>
              <small>내 여름 캐릭터로 참여해요</small>
              <strong>{SUMMER_TYPE_RESULTS[savedType].name}</strong>
            </span>
          </div>
        ) : null}
        {availableItems.length > 0 ? (
          <fieldset className="join-claim-picker">
            <legend>
              내가 챙길 준비물 <small>선택</small>
            </legend>
            <div>
              {availableItems.map((item) => {
                const selected = item.id === claimItemId;
                return (
                  <button
                    className={selected ? "is-selected" : ""}
                    type="button"
                    key={item.id}
                    aria-pressed={selected}
                    onClick={() =>
                      setClaimItemId((current) =>
                        current === item.id ? null : item.id,
                      )
                    }
                  >
                    <ItemVisual visual={item.visual} compact />
                    <span>{item.label}</span>
                    {selected ? <CheckIcon aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="sheet-primary"
          type="submit"
          disabled={submitting || isFull}
        >
          <PersonIcon aria-hidden="true" />
          {submitting
            ? "참여하고 있어요…"
            : claimItem
              ? `참여하고 ${withObject(claimItem.label)} 맡기`
              : "모임에 참여하기"}
        </button>
      </form>
    </Sheet>
  );
}

function OutingEditSheet({
  open,
  bundle,
  activities,
  onClose,
  onSaved,
  onDeleted,
  getToken,
}: {
  open: boolean;
  bundle: OutingBundle;
  activities: ActivityOption[];
  onClose: () => void;
  onSaved: (bundle: OutingBundle) => void;
  onDeleted: () => void;
  getToken: () => string;
}) {
  const outing = bundle.outing;
  const [places, setPlaces] = useState<Place[]>([]);
  const [title, setTitle] = useState(outing.title);
  const [date, setDate] = useState(koreaDateKey(outing.startsAt));
  const [people, setPeople] = useState(outing.expectedPeople);
  const [activityType, setActivityType] = useState(outing.activityType);
  const [placeId, setPlaceId] = useState(outing.placeId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(outing.title);
    setDate(koreaDateKey(outing.startsAt));
    setPeople(outing.expectedPeople);
    setActivityType(outing.activityType);
    setPlaceId(outing.placeId);
    setError("");
    setDeleteConfirm(false);
    if (places.length === 0) {
      listPlaces()
        .then((result) => setPlaces(result.places))
        .catch(() => setError("장소 목록을 불러오지 못했어요."));
    }
    // 시트를 열 때마다 현재 모임 값으로 초기화해요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isCustomPlace =
    places.length > 0 && !places.some((place) => place.id === outing.placeId);
  const today = todayDateKey();
  const originalDate = koreaDateKey(outing.startsAt);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("모임 이름을 입력해 주세요.");
      return;
    }
    if (!date || (date < today && date !== originalDate)) {
      setError("오늘 이후 날짜를 골라 주세요.");
      return;
    }
    const patch: Parameters<typeof updateOuting>[2] = {};
    if (trimmedTitle !== outing.title) patch.title = trimmedTitle;
    if (date !== originalDate) {
      const time = formatKoreaTime(outing.startsAt) || "10:00";
      patch.startsAt = `${date}T${time}:00+09:00`;
    }
    if (people !== outing.expectedPeople) patch.expectedPeople = people;
    if (activityType !== outing.activityType) patch.activityType = activityType;
    if (placeId !== outing.placeId) patch.placeId = placeId;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await updateOuting(outing.id, getToken(), patch);
      onSaved(result.outing);
    } catch (saveError) {
      setError(errorMessage(saveError, "모임 정보를 바꾸지 못했어요."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteOuting(outing.id, getToken());
      onDeleted();
    } catch (deleteError) {
      setError(errorMessage(deleteError, "모임을 삭제하지 못했어요."));
      setDeleting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!saving && !deleting) onClose();
      }}
      title="모임 정보 수정"
      description="바꾼 내용은 참여한 친구들에게 바로 반영돼요. 준비물과 담당은 그대로예요."
    >
      <form className="create-form outing-edit-form" onSubmit={save}>
        <label>
          <span>모임 이름</span>
          <input
            maxLength={32}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            <span>날짜</span>
            <input
              type="date"
              min={today < originalDate ? today : originalDate}
              max={addDaysToDateKey(today, 365)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="people-count-field people-count-field--compact">
            <span>예상 인원</span>
            <div className="people-count-control">
              <button
                type="button"
                aria-label="인원 한 명 줄이기"
                disabled={people <= 1}
                onClick={() => setPeople((value) => Math.max(1, value - 1))}
              >
                −
              </button>
              <output aria-live="polite">{people}명</output>
              <button
                type="button"
                aria-label="인원 한 명 늘리기"
                disabled={people >= MAX_EXPECTED_PEOPLE}
                onClick={() =>
                  setPeople((value) => Math.min(MAX_EXPECTED_PEOPLE, value + 1))
                }
              >
                +
              </button>
            </div>
          </div>
        </div>
        {activities.length > 0 ? (
          <fieldset className="activity-chip-picker">
            <legend>모임 유형</legend>
            <div>
              {activities.map((activity) => (
                <button
                  className={activityType === activity.key ? "is-selected" : ""}
                  type="button"
                  key={activity.key}
                  aria-pressed={activityType === activity.key}
                  onClick={() => setActivityType(activity.key)}
                >
                  {activityIcon(activity.key)}
                  {activity.label}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="place-picker">
          <legend>만날 장소</legend>
          {isCustomPlace ? (
            <button
              className={`place-card-option place-card-option--current${
                placeId === outing.placeId ? " is-selected" : ""
              }`}
              type="button"
              aria-pressed={placeId === outing.placeId}
              onClick={() => setPlaceId(outing.placeId)}
            >
              <img
                src={placeArtwork(null, null)}
                alt=""
                draggable={false}
              />
              <span className="place-card-option__copy">
                <strong>{outing.placeName}</strong>
                <small>지금 장소 · 직접 검색한 장소</small>
              </span>
              <span className="place-card-option__check" aria-hidden="true">
                {placeId === outing.placeId ? <CheckIcon /> : null}
              </span>
            </button>
          ) : null}
          <PlacePicker
            places={places}
            value={placeId}
            onChange={(place) => setPlaceId(place.id)}
          />
        </fieldset>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="sheet-primary" type="submit" disabled={saving}>
          {saving ? "저장하고 있어요…" : "바꾼 내용 저장하기"}
        </button>
        <div className="outing-edit-danger">
          {deleteConfirm ? (
            <div className="invite-reset-confirm" role="alert">
              <p>
                준비물, 담당자, 진행 기록이 모두 삭제되며 되돌릴 수 없어요.
                초대받은 친구도 더 이상 이 모임을 열 수 없어요.
              </p>
              <div>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteConfirm(false)}
                >
                  취소
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  <TrashIcon aria-hidden="true" />
                  {deleting ? "삭제하고 있어요…" : "모임 삭제"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="sheet-text-button sheet-text-button--danger"
              type="button"
              onClick={() => setDeleteConfirm(true)}
            >
              이 모임 삭제하기
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

