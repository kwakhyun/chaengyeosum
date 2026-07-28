import assert from "node:assert/strict";
import test from "node:test";

import { getSmartPackingRecommendations } from "./smart-packing.mjs";

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
