import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateCurrentCrowd,
  fetchSeoulCurrentCrowd,
} from "./crowd-intelligence.mjs";
import { getPlace } from "./places.mjs";

test("예상 혼잡도는 같은 장소의 주말 인기 시간대를 더 붐비게 본다", () => {
  const place = getPlace("gwangalli");
  const quiet = estimateCurrentCrowd(
    place,
    new Date("2026-07-27T22:30:00Z"),
  );
  const busy = estimateCurrentCrowd(
    place,
    new Date("2026-08-01T11:00:00Z"),
  );
  assert.ok(busy.score > quiet.score);
  assert.equal(busy.mode, "estimate");
  assert.match(busy.label, /예상/);
});

test("서울 실시간 인구 응답을 공식 혼잡 신호로 변환한다", async () => {
  const result = await fetchSeoulCurrentCrowd({
    place: getPlace("yeouido-hangang"),
    apiKey: "secret",
    now: new Date("2026-07-29T05:00:00Z"),
    fetchImpl: async (url) => {
      assert.match(url, /citydata_ppltn/);
      return new Response(
        JSON.stringify({
          SeoulRtd: {
            row: [
              {
                AREA_CONGEST_LVL: "약간 붐빔",
                AREA_CONGEST_MSG: "사람이 몰려 이동에 주의가 필요해요.",
                AREA_PPLTN_MIN: "12000",
                AREA_PPLTN_MAX: "14000",
                PPLTN_TIME: "2026-07-29 14:00",
                FCST_PPLTN: [
                  {
                    FCST_TIME: "2026-07-29 15:00",
                    FCST_CONGEST_LVL: "약간 붐빔",
                    FCST_PPLTN_MIN: "15000",
                    FCST_PPLTN_MAX: "17000",
                  },
                  {
                    FCST_TIME: "2026-07-29 18:00",
                    FCST_CONGEST_LVL: "여유",
                    FCST_PPLTN_MIN: "9000",
                    FCST_PPLTN_MAX: "11000",
                  },
                ],
              },
            ],
          },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(result.mode, "live");
  assert.equal(result.level, "busy");
  assert.equal(result.populationRange, "12,000~14,000명");
  assert.equal(result.forecast.length, 2);
  assert.equal(result.forecast[1].populationRange, "9,000~11,000명");
  assert.equal(result.timingAdvice.verdict, "18:00 출발 추천");
  assert.match(result.timingAdvice.summary, /23% 여유/);
  assert.ok(result.source.url.startsWith("https://data.seoul.go.kr"));
});
