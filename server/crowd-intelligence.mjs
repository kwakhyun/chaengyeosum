const SEOUL_CROWD_SOURCE_URL = "https://data.seoul.go.kr/SeoulRtd/";
const CROWD_LEVELS = {
  relaxed: { label: "여유", score: 25 },
  normal: { label: "보통", score: 47 },
  busy: { label: "약간 붐빔", score: 68 },
  very_busy: { label: "붐빔", score: 87 },
};

function cleanText(value, maxLength = 160) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function kstParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
    month: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    hour: Number(values.hour),
    month: Number(values.month),
    weekend: values.weekday === "Sat" || values.weekday === "Sun",
  };
}

function estimateLevel(score) {
  if (score < 36) return "relaxed";
  if (score < 57) return "normal";
  if (score < 77) return "busy";
  return "very_busy";
}

function placeKind(place) {
  if (
    place.category === "waterpark" ||
    place.name.includes("워터파크") ||
    place.name.includes("캐리비안") ||
    place.name.includes("오션월드")
  ) {
    return "waterpark";
  }
  if (place.category === "beach" || place.name.includes("해수욕장")) {
    return "beach";
  }
  if (place.category === "valley" || place.name.includes("계곡")) {
    return "valley";
  }
  if (place.name.includes("한강") || place.name.includes("공원")) {
    return "park";
  }
  return "general";
}

export function estimateCurrentCrowd(place, now = new Date()) {
  const { hour, month, weekend } = kstParts(now);
  const kind = placeKind(place);
  let score = Number(place.crowdBaseline ?? 45);
  const reasons = [];

  if (weekend) {
    score += 11;
    reasons.push("주말 방문 수요를 반영했어요");
  } else {
    score -= 4;
    reasons.push("평일 시간대를 반영했어요");
  }

  if (hour >= 18 && hour <= 21) {
    score +=
      kind === "park" || kind === "beach" || kind === "valley"
        ? 14
        : kind === "waterpark"
          ? 4
          : 9;
    reasons.push("저녁 인기 시간대예요");
  } else if (hour >= 13 && hour < 18) {
    score += kind === "waterpark" ? 12 : 8;
    reasons.push("오후 방문이 늘어나는 시간이에요");
  } else if (hour < 9 || hour >= 23) {
    score -= 18;
    reasons.push("방문이 적은 시간대예요");
  } else {
    score -= 3;
    reasons.push("보통 방문 시간대예요");
  }

  if (
    month >= 6 &&
    month <= 8 &&
    (
      kind === "park" ||
      kind === "beach" ||
      kind === "valley" ||
      kind === "waterpark"
    )
  ) {
    score += kind === "waterpark" ? 12 : 8;
    reasons.push(
      kind === "waterpark"
        ? "여름철 인기 워터파크예요"
        : "여름철 인기 야외 장소예요",
    );
  }

  const normalizedScore = Math.round(clamp(score, 14, 94));
  const level = estimateLevel(normalizedScore);
  const state = CROWD_LEVELS[level];
  return {
    mode: "estimate",
    level,
    label: `${state.label} 예상`,
    score: normalizedScore,
    summary:
      level === "very_busy"
        ? "지금은 사람이 많이 몰릴 가능성이 높아요."
        : level === "busy"
          ? "지금은 평소보다 붐빌 가능성이 있어요."
          : level === "normal"
            ? "지금은 보통 수준으로 예상돼요."
            : "지금은 비교적 여유로울 가능성이 높아요.",
    reasons: reasons.slice(0, 3),
    populationRange: null,
    observedAt: now.toISOString(),
    source: {
      name: "챙겨썸 예상 혼잡도",
      url: null,
      note: "요일·시간·계절·장소 인기도를 조합한 참고용 예상치",
    },
    liveSupported: Boolean(place.seoulCrowdArea),
    forecast: [],
    timingAdvice: null,
  };
}

function normalizeOfficialLevel(value) {
  const label = cleanText(value, 40);
  if (label.includes("붐빔") && !label.includes("약간")) {
    return "very_busy";
  }
  if (label.includes("약간") || label.includes("혼잡")) return "busy";
  if (label.includes("여유")) return "relaxed";
  return "normal";
}

function findCrowdPayload(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return null;
  if (typeof value.AREA_CONGEST_LVL === "string") return value;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findCrowdPayload(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function populationRange(minimumValue, maximumValue) {
  const minimum = Number(minimumValue);
  const maximum = Number(maximumValue);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return null;
  }
  return {
    minimum,
    maximum,
    midpoint: Math.round((minimum + maximum) / 2),
    label: `${minimum.toLocaleString("ko-KR")}~${maximum.toLocaleString("ko-KR")}명`,
  };
}

function parseForecast(crowd) {
  const rows = Array.isArray(crowd.FCST_PPLTN) ? crowd.FCST_PPLTN : [];
  return rows
    .map((row) => {
      const range = populationRange(
        row?.FCST_PPLTN_MIN,
        row?.FCST_PPLTN_MAX,
      );
      const time = cleanText(row?.FCST_TIME, 40);
      if (!range || !time) return null;
      const level = normalizeOfficialLevel(row.FCST_CONGEST_LVL);
      return {
        time,
        level,
        label: CROWD_LEVELS[level].label,
        score: CROWD_LEVELS[level].score,
        populationRange: range.label,
        populationMidpoint: range.midpoint,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function getTimingAdvice(currentLevel, currentMidpoint, forecast) {
  if (forecast.length === 0) return null;
  const best = forecast.reduce((selected, item) =>
    item.populationMidpoint < selected.populationMidpoint ? item : selected,
  );
  const peak = forecast.reduce((selected, item) =>
    item.populationMidpoint > selected.populationMidpoint ? item : selected,
  );
  const bestIsMeaningfullyLower =
    Number.isFinite(currentMidpoint) &&
    best.populationMidpoint <= currentMidpoint * 0.88;
  const currentIsComfortable =
    currentLevel === "relaxed" || currentLevel === "normal";

  if (
    currentIsComfortable &&
    (!bestIsMeaningfullyLower || peak.populationMidpoint > currentMidpoint * 1.2)
  ) {
    return {
      verdict: "지금 출발 추천",
      summary: `${peak.time.slice(11, 16)} 무렵 더 붐빌 수 있어 지금 움직이는 편이 좋아요.`,
      bestTime: best.time,
      bestLabel: best.label,
      peakTime: peak.time,
      peakLabel: peak.label,
    };
  }
  if (bestIsMeaningfullyLower) {
    return {
      verdict: `${best.time.slice(11, 16)} 출발 추천`,
      summary: `지금보다 약 ${Math.round(
        (1 - best.populationMidpoint / currentMidpoint) * 100,
      )}% 여유로울 전망이에요.`,
      bestTime: best.time,
      bestLabel: best.label,
      peakTime: peak.time,
      peakLabel: peak.label,
    };
  }
  return {
    verdict: "시간대 차이가 크지 않아요",
    summary: `향후 12시간 중 ${best.time.slice(11, 16)} 무렵이 가장 여유로울 전망이에요.`,
    bestTime: best.time,
    bestLabel: best.label,
    peakTime: peak.time,
    peakLabel: peak.label,
  };
}

export async function fetchSeoulCurrentCrowd({
  place,
  apiKey,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!apiKey || !place?.seoulCrowdArea) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchImpl(
      [
        // 서울 열린데이터광장의 공식 실시간 인구 API는 8088 HTTP
        // 엔드포인트를 사용해요. 키는 Worker secret에서만 읽습니다.
        "http://openapi.seoul.go.kr:8088",
        encodeURIComponent(apiKey),
        "json",
        "citydata_ppltn",
        "1",
        "5",
        encodeURIComponent(place.seoulCrowdArea),
      ].join("/"),
      { signal: controller.signal },
    );
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: "seoul_crowd_fetch_failed",
          reason: "http_status",
          status: response.status,
          area: place.seoulCrowdArea,
        }),
      );
      return null;
    }
    const payload = await response.json();
    const crowd = findCrowdPayload(payload);
    if (!crowd) {
      console.warn(
        JSON.stringify({
          event: "seoul_crowd_fetch_failed",
          reason: "invalid_payload",
          area: place.seoulCrowdArea,
        }),
      );
      return null;
    }

    const level = normalizeOfficialLevel(crowd.AREA_CONGEST_LVL);
    const state = CROWD_LEVELS[level];
    const currentPopulation = populationRange(
      crowd.AREA_PPLTN_MIN,
      crowd.AREA_PPLTN_MAX,
    );
    const forecast = parseForecast(crowd);
    const officialMessage = cleanText(crowd.AREA_CONGEST_MSG, 180);
    return {
      mode: "live",
      level,
      label: state.label,
      score: state.score,
      summary:
        officialMessage ||
        `서울시 실시간 인구 기준 현재 ${state.label} 단계예요.`,
      reasons: [
        currentPopulation
          ? `추정 인구 ${currentPopulation.label}`
          : "",
        "통신사 실시간 인구와 장소 면적을 함께 분석해요",
      ].filter(Boolean),
      populationRange: currentPopulation?.label ?? null,
      observedAt: cleanText(crowd.PPLTN_TIME, 40) || now.toISOString(),
      source: {
        name: "서울 실시간 도시데이터",
        url: SEOUL_CROWD_SOURCE_URL,
        note: "서울시 주요 장소 실시간 인구 혼잡도",
      },
      liveSupported: true,
      forecast,
      timingAdvice: getTimingAdvice(
        level,
        currentPopulation?.midpoint,
        forecast,
      ),
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "seoul_crowd_fetch_failed",
        reason:
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "network_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        area: place.seoulCrowdArea,
      }),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCurrentCrowdIntelligence({
  place,
  apiKey,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const live = await fetchSeoulCurrentCrowd({
    place,
    apiKey,
    fetchImpl,
    now,
  });
  return live ?? estimateCurrentCrowd(place, now);
}
