import assert from "node:assert/strict";
import test from "node:test";

import {
  getQuantityPeople,
  getSmartPackingRecommendations,
  getSuggestedQuantity,
  normalizeExpectedPeople,
  parseExpectedPeople,
} from "./smart-packing.mjs";

test("폭염·높은 자외선·비 예보를 준비물 추천에 반영한다", () => {
  const recommendations = getSmartPackingRecommendations({
    activityType: "water-play",
    place: { id: "gwangalli" },
    expectedPeople: 5,
    weather: {
      maxTemperature: 34,
      uvIndex: 8,
      uvLabel: "자외선 매우 높음",
      precipitationProbability: 60,
      condition: "소나기",
    },
  });
  const byKey = new Map(
    recommendations.map((item) => [item.key, item.reason]),
  );

  assert.equal(byKey.get("water"), "34℃ 더위 대비");
  assert.equal(byKey.get("sunscreen"), "자외선 매우 높음");
  assert.equal(byKey.get("umbrella"), "비 올 확률 60%");
  assert.ok(byKey.has("fan"));
  assert.ok(byKey.has("waterproof-pouch"));
  assert.equal(
    recommendations.find((item) => item.key === "water").quantityLabel,
    "5명 기준 10병",
  );
  assert.equal(
    recommendations.find((item) => item.key === "sunscreen")
      .quantityLabel,
    "5명 기준 2개",
  );
});

test("물가 여부는 장소 분류로, 직접 고른 장소는 활동으로 판단한다", () => {
  const keys = (options) =>
    getSmartPackingRecommendations({ weather: null, ...options }).map(
      (item) => item.key,
    );
  for (const category of ["beach", "valley", "waterpark"]) {
    assert.ok(
      keys({ activityType: "picnic", place: { id: "x", category } }).includes(
        "waterproof-pouch",
      ),
      category,
    );
  }
  assert.equal(
    keys({
      activityType: "picnic",
      place: { id: "custom:1:2", category: null },
    }).includes("waterproof-pouch"),
    false,
  );
  assert.ok(
    keys({
      activityType: "water-play",
      place: { id: "custom:1:2", category: null },
    }).includes("waterproof-pouch"),
  );
});

test("수량 인원은 1~50명이고 직접 추가한 준비물은 1개로 안내한다", () => {
  assert.equal(normalizeExpectedPeople(undefined), 2);
  assert.equal(normalizeExpectedPeople("abc"), 2);
  assert.equal(normalizeExpectedPeople(999), 50);
  assert.equal(parseExpectedPeople(50), 50);
  assert.equal(parseExpectedPeople(51), null);
  assert.equal(parseExpectedPeople("3"), 3);
  assert.equal(getQuantityPeople(2, 7), 7);
  assert.equal(getQuantityPeople(10, 3), 10);
  assert.equal(getQuantityPeople(40, 60), 50);
  assert.deepEqual(getSuggestedQuantity("custom_abc123", 10), {
    quantity: 1,
    unit: "개",
    quantityLabel: "1개",
  });
  assert.equal(getSuggestedQuantity("water", 3).quantityLabel, "3명 기준 6병");
});
