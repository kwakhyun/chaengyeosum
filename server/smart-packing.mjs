import { getItemOption } from "./item-options.mjs";

export const ACTIVITY_TYPES = [
  {
    key: "water-play",
    label: "물놀이",
    description: "수영장·해수욕장",
  },
  {
    key: "picnic",
    label: "피크닉",
    description: "한강·공원 나들이",
  },
  {
    key: "festival",
    label: "페스티벌",
    description: "공연·야외 축제",
  },
  {
    key: "camping",
    label: "캠핑",
    description: "야영·글램핑",
  },
  {
    key: "trip",
    label: "여름 여행",
    description: "휴가·당일치기",
  },
];

const ACTIVITY_RULES = {
  "water-play": [
    ["towel", "물놀이 필수"],
    ["water", "수분 보충"],
    ["sunscreen", "야외 자외선 대비"],
    ["swimwear", "물놀이 준비"],
    ["waterproof-pouch", "휴대폰 방수"],
    ["change-clothes", "젖은 옷 교체"],
  ],
  picnic: [
    ["mat", "피크닉 자리 준비"],
    ["water", "수분 보충"],
    ["snack", "함께 나눠 먹기"],
    ["sunscreen", "야외 자외선 대비"],
    ["hat", "햇빛 차단"],
    ["trash-bag", "머문 자리 정리"],
  ],
  festival: [
    ["water", "오래 서 있을 때 수분 보충"],
    ["battery", "촬영·연락 배터리"],
    ["sunscreen", "야외 자외선 대비"],
    ["hat", "대기 중 햇빛 차단"],
    ["camera", "여름 추억 기록"],
    ["ticket", "입장 전 확인"],
  ],
  camping: [
    ["mat", "야외 휴식"],
    ["water", "수분 보충"],
    ["snack", "간편한 먹거리"],
    ["battery", "야외 충전 대비"],
    ["bug-spray", "야외 벌레 대비"],
    ["trash-bag", "캠핑 자리 정리"],
  ],
  trip: [
    ["water", "이동 중 수분 보충"],
    ["battery", "길찾기·연락 배터리"],
    ["camera", "여름 추억 기록"],
    ["change-clothes", "여분 옷 준비"],
    ["first-aid", "여행 중 작은 상처 대비"],
    ["sunscreen", "여름 자외선 대비"],
  ],
};

export function isActivityType(value) {
  return ACTIVITY_TYPES.some((activity) => activity.key === value);
}

export function getActivityType(value) {
  return isActivityType(value) ? value : "picnic";
}

export const MAX_EXPECTED_PEOPLE = 999;

export function normalizeExpectedPeople(value, fallback = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_EXPECTED_PEOPLE,
    Math.max(1, Math.round(parsed)),
  );
}

export function getSuggestedQuantity(key, expectedPeople = 2) {
  const people = normalizeExpectedPeople(expectedPeople);
  const quantityByKey = {
    water: [people * 2, "병"],
    towel: [people, "개"],
    umbrella: [people, "개"],
    hat: [people, "개"],
    swimwear: [people, "벌"],
    "change-clothes": [people, "벌"],
    "waterproof-pouch": [people, "개"],
    ticket: [people, "장"],
    snack: [people, "개"],
    mat: [Math.ceil(people / 3), "개"],
    sunscreen: [Math.ceil(people / 4), "개"],
    battery: [Math.ceil(people / 2), "개"],
    fan: [Math.ceil(people / 2), "개"],
  };
  const [quantity, unit] = quantityByKey[key] ?? [1, "개"];
  return {
    quantity,
    unit,
    quantityLabel: `${people}명 기준 ${quantity}${unit}`,
  };
}

export function getSmartPackingRecommendations({
  activityType,
  place,
  weather,
  expectedPeople = 2,
}) {
  const reasons = new Map();
  const order = [];

  const recommend = (key, reason, priority = false) => {
    if (!getItemOption(key)) return;
    if (!reasons.has(key)) order.push(key);
    if (priority || !reasons.has(key)) reasons.set(key, reason);
  };

  for (const [key, reason] of ACTIVITY_RULES[getActivityType(activityType)]) {
    recommend(key, reason);
  }

  if (
    place?.id === "gwangalli" ||
    place?.id === "eulwangri" ||
    activityType === "water-play"
  ) {
    recommend("waterproof-pouch", "물가에서 휴대폰 방수");
    recommend("change-clothes", "젖은 옷 교체");
  }

  if (weather) {
    if (weather.maxTemperature >= 30) {
      recommend("water", `${weather.maxTemperature}℃ 더위 대비`, true);
      recommend("fan", `${weather.maxTemperature}℃ 더위 대비`, true);
      recommend("towel", "땀과 열기 식히기");
    }
    if (weather.uvIndex >= 6) {
      recommend("sunscreen", weather.uvLabel, true);
      recommend("hat", weather.uvLabel, true);
    }
    if (
      weather.precipitationProbability >= 40 ||
      weather.condition === "비" ||
      weather.condition === "소나기"
    ) {
      recommend(
        "umbrella",
        `비 올 확률 ${weather.precipitationProbability}%`,
        true,
      );
      recommend("waterproof-pouch", "갑작스러운 비 대비", true);
    }
  }

  return order
    .map((key) => {
      const option = getItemOption(key);
      return option
        ? {
            key: option.key,
            label: option.label,
            visual: option.visual,
            reason: reasons.get(key) ?? "활동 맞춤 추천",
            ...getSuggestedQuantity(option.key, expectedPeople),
          }
        : null;
    })
    .filter(Boolean);
}
