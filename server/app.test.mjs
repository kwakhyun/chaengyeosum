import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createApiServer } from "./app.mjs";
import { addDaysToDateKey } from "./kst-date.mjs";
import { mapOutingRow, RATE_LIMITS } from "./outing-rules.mjs";
import { getKoreaDateKey } from "./weather.mjs";

function futureStartsAt(daysAhead = 7, time = "14:00") {
  return `${addDaysToDateKey(getKoreaDateKey(), daysAhead)}T${time}:00+09:00`;
}

async function call(
  baseUrl,
  path,
  { method = "GET", token, userKey, body, headers = {} } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(userKey ? { "x-chaengyeosum-user-key": userKey } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text ? JSON.parse(text) : null,
  };
}

async function createTestOuting(baseUrl, overrides = {}, { userKey } = {}) {
  const result = await call(baseUrl, "/api/outings", {
    method: "POST",
    userKey,
    body: {
      title: "테스트 모임",
      placeId: "seoul-forest",
      startsAt: futureStartsAt(3),
      activityType: "picnic",
      expectedPeople: 2,
      creatorName: "모임장",
      itemKeys: ["water", "mat", "hat"],
      ...overrides,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

function joinTestOuting(baseUrl, created, name, extra = {}, { userKey } = {}) {
  return call(baseUrl, `/api/outings/${created.outing.outing.id}/join`, {
    method: "POST",
    userKey,
    body: {
      inviteCode: created.outing.outing.inviteCode,
      name,
      ...extra,
    },
  });
}

function forecastStub(counter, { fail = false } = {}) {
  return async (url) => {
    assert.match(String(url), /open-meteo/);
    counter.calls += 1;
    if (fail) return new Response("{}", { status: 500 });
    const today = getKoreaDateKey();
    const time = Array.from({ length: 16 }, (_, index) =>
      addDaysToDateKey(today, index),
    );
    return new Response(
      JSON.stringify({
        daily: {
          time,
          weather_code: time.map(() => 1),
          temperature_2m_min: time.map(() => 24),
          temperature_2m_max: time.map(() => 31),
          precipitation_probability_max: time.map(() => 10),
          uv_index_max: time.map(() => 7),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function withServer(run, options = {}) {
  const app = createApiServer({
    dbFile: ":memory:",
    weatherEnabled: false,
    ...options,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
  }
}

test("모임 생성, 초대 참여, 공동 체크 상태가 API에 저장된다", async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "주말 한강 피크닉",
        placeId: "yeouido-hangang",
        startsAt: futureStartsAt(1, "14:00"),
        activityType: "water-play",
        expectedPeople: 4,
        creatorName: "현우",
        itemKeys: ["water", "hat"],
        customItems: ["보드게임"],
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    const outingId = created.outing.outing.id;
    const inviteCode = created.outing.outing.inviteCode;
    const firstItem = created.outing.items.find((item) => item.owner == null);
    assert.equal(created.outing.items.length, 3);
    assert.equal(created.outing.outing.activityType, "water-play");
    assert.equal(created.outing.outing.expectedPeople, 4);
    assert.equal(
      created.outing.items.find((item) => item.key === "water")
        .quantityLabel,
      "4명 기준 8병",
    );
    assert.ok(
      created.outing.items.some((item) => item.label === "보드게임"),
    );
    assert.equal(
      created.outing.items.find((item) => item.label === "보드게임").visual,
      "asset:item-custom-3d.png",
    );

    const joinResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode, name: "민지" }),
      },
    );
    assert.equal(joinResponse.status, 201);
    const joined = await joinResponse.json();
    assert.equal(joined.outing.participants.length, 2);

    const updateResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/items/${firstItem.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${joined.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ownerId: joined.session.participantId,
          done: true,
        }),
      },
    );
    assert.equal(updateResponse.status, 200);

    const creatorViewResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}`,
      {
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      },
    );
    assert.equal(creatorViewResponse.status, 200);
    const creatorView = await creatorViewResponse.json();
    const updatedItem = creatorView.items.find(
      (item) => item.id === firstItem.id,
    );
    assert.equal(updatedItem.owner.name, "민지");
    assert.equal(updatedItem.done, true);

    const addResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/items`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ optionKey: "camera" }),
      },
    );
    assert.equal(addResponse.status, 201);
    const added = await addResponse.json();

    const deleteResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/items/${added.itemId}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      },
    );
    assert.equal(deleteResponse.status, 200);

    const randomizeResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/randomize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      },
    );
    assert.equal(randomizeResponse.status, 200);

    const randomizedView = await fetch(
      `${baseUrl}/api/outings/${outingId}`,
      {
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      },
    ).then((response) => response.json());
    assert.equal(
      randomizedView.items.every((item) => item.owner != null),
      true,
    );
    assert.ok(
      randomizedView.events.some((event) => event.type === "randomized"),
    );

    const reactedEvent = randomizedView.events[0];
    const reactionResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/events/${reactedEvent.id}/reaction`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reactionType: "heart" }),
      },
    );
    assert.equal(reactionResponse.status, 200);

    const reactedView = await fetch(
      `${baseUrl}/api/outings/${outingId}`,
      {
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      },
    ).then((response) => response.json());
    const eventAfterReaction = reactedView.events.find(
      (event) => event.id === reactedEvent.id,
    );
    assert.equal(eventAfterReaction.reactions.heart, 1);
    assert.equal(eventAfterReaction.viewerReaction, "heart");

    const toggleOffResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/events/${reactedEvent.id}/reaction`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reactionType: "heart" }),
      },
    );
    assert.equal(toggleOffResponse.status, 200);
    assert.equal((await toggleOffResponse.json()).reaction, null);
  });
});

test("토스 익명 식별키로 내 모임을 복구하고 참여자 권한을 유지한다", async () => {
  await withServer(async (baseUrl) => {
    const anonymousHeaders = {
      "content-type": "application/json",
      "x-chaengyeosum-user-key": "toss-anonymous-user-test-001",
    };
    const createdResponse = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: anonymousHeaders,
      body: JSON.stringify({
        title: "익명키 복구 모임",
        placeId: "seoul-forest",
        startsAt: futureStartsAt(9, "10:00"),
        activityType: "picnic",
        expectedPeople: 3,
        creatorName: "익명사용자",
        itemKeys: ["water", "mat"],
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const recoveredResponse = await fetch(`${baseUrl}/api/me/outings`, {
      headers: {
        "x-chaengyeosum-user-key": "toss-anonymous-user-test-001",
      },
    });
    assert.equal(recoveredResponse.status, 200);
    const recovered = await recoveredResponse.json();
    assert.equal(recovered.sessions.length, 1);
    assert.equal(recovered.sessions[0].outingId, created.outing.outing.id);
    assert.equal(recovered.sessions[0].token, "");

    const outingResponse = await fetch(
      `${baseUrl}/api/outings/${created.outing.outing.id}`,
      {
        headers: {
          "x-chaengyeosum-user-key": "toss-anonymous-user-test-001",
        },
      },
    );
    assert.equal(outingResponse.status, 200);
    const outing = await outingResponse.json();
    assert.equal(outing.viewer.id, created.session.participantId);
    assert.equal(outing.canDelete, true);

    const updateResponse = await fetch(
      `${baseUrl}/api/outings/${created.outing.outing.id}/items/${outing.items[0].id}`,
      {
        method: "PATCH",
        headers: anonymousHeaders,
        body: JSON.stringify({ done: true }),
      },
    );
    assert.equal(updateResponse.status, 200);

    const legacyCreated = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "기존 세션 연결 모임",
        placeId: "yeouido-hangang",
        startsAt: futureStartsAt(10, "10:00"),
        activityType: "picnic",
        expectedPeople: 2,
        creatorName: "기존사용자",
        itemKeys: ["water"],
      }),
    }).then((response) => response.json());
    const linkResponse = await fetch(
      `${baseUrl}/api/outings/${legacyCreated.outing.outing.id}`,
      {
        headers: {
          authorization: `Bearer ${legacyCreated.session.token}`,
          "x-chaengyeosum-user-key": "toss-anonymous-user-test-001",
        },
      },
    );
    assert.equal(linkResponse.status, 200);

    const linkedSessions = await fetch(`${baseUrl}/api/me/outings`, {
      headers: {
        "x-chaengyeosum-user-key": "toss-anonymous-user-test-001",
      },
    }).then((response) => response.json());
    assert.equal(linkedSessions.sessions.length, 2);
  });
});

test("검색한 사용자 장소의 좌표와 이름으로 모임을 만든다", async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "제주 여름 여행",
        placeId: "custom:33.49962:126.53119",
        customPlace: {
          id: "custom:33.49962:126.53119",
          name: "제주시, 제주특별자치도",
          latitude: 33.49962,
          longitude: 126.53119,
        },
        startsAt: futureStartsAt(5, "10:00"),
        activityType: "trip",
        expectedPeople: 25,
        creatorName: "테스터",
        itemKeys: ["water", "battery"],
      }),
    }).then((response) => response.json());

    assert.equal(created.outing.outing.placeName, "제주시, 제주특별자치도");
    assert.equal(created.outing.outing.latitude, 33.49962);
    assert.equal(created.outing.outing.expectedPeople, 25);
    assert.equal(
      created.outing.items.find((item) => item.key === "battery")
        .quantityLabel,
      "25명 기준 13개",
    );
  });
});

test("메인 화면에 네 지역의 오늘 날씨를 제공한다", async () => {
  const today = getKoreaDateKey();
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        daily: {
          time: [today],
          weather_code: [1],
          temperature_2m_min: [24.1],
          temperature_2m_max: [32.4],
          precipitation_probability_max: [20],
          uv_index_max: [7.2],
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/weather-highlights`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.regions.length, 4);
      assert.deepEqual(
        payload.regions.map((region) => region.name),
        ["서울", "부산", "강릉", "제주"],
      );
      assert.equal(payload.regions[0].weather.minTemperature, 24);
      assert.equal(payload.regions[0].weather.maxTemperature, 32);
      assert.equal(payload.regions[0].weather.uvLabel, "자외선 높음");
    },
    { weatherEnabled: true, fetchImpl },
  );
});

test("초대 코드나 참여 토큰이 없으면 모임을 읽을 수 없다", async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "비공개 물놀이",
        placeId: "gwangalli",
        startsAt: futureStartsAt(2, "10:00"),
        creatorName: "서연",
      }),
    }).then((response) => response.json());

    const response = await fetch(
      `${baseUrl}/api/outings/${created.outing.outing.id}`,
    );
    assert.equal(response.status, 403);
  });
});

test("모임은 최초 생성자만 삭제할 수 있고 삭제 후에는 조회되지 않는다", async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "삭제 권한 확인 모임",
        placeId: "seoul-forest",
        startsAt: futureStartsAt(9, "18:00"),
        activityType: "picnic",
        expectedPeople: 3,
        creatorName: "모임장",
        itemKeys: ["water", "mat"],
        customItems: [],
      }),
    });
    const created = await createResponse.json();
    const outingId = created.outing.outing.id;

    const joinResponse = await fetch(
      `${baseUrl}/api/outings/${outingId}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteCode: created.outing.outing.inviteCode,
          name: "친구",
        }),
      },
    );
    const joined = await joinResponse.json();

    const denied = await fetch(`${baseUrl}/api/outings/${outingId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${joined.session.token}`,
      },
    });
    assert.equal(denied.status, 403);

    const deleted = await fetch(`${baseUrl}/api/outings/${outingId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${created.session.token}`,
      },
    });
    assert.equal(deleted.status, 200);

    const missing = await fetch(`${baseUrl}/api/outings/${outingId}`, {
      headers: {
        authorization: `Bearer ${created.session.token}`,
      },
    });
    assert.equal(missing.status, 404);
  });
});

test("준비물은 1개 이상 15개 이하로 유지된다", async () => {
  await withServer(async (baseUrl) => {
    const options = await fetch(`${baseUrl}/api/item-options`).then(
      (response) => response.json(),
    );
    assert.equal(options.options.length, 18);
    assert.equal(options.maxItems, 15);
    assert.ok(
      options.options.every((option) => option.visual.startsWith("asset:")),
    );

    const created = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "준비물 경계 테스트",
        placeId: "yeouido-hangang",
        startsAt: futureStartsAt(3, "10:00"),
        creatorName: "테스터",
        itemKeys: options.options.map((option) => option.key),
        customItems: ["커스텀1", "커스텀2", "커스텀3"],
      }),
    }).then((response) => response.json());
    assert.equal(created.outing.items.length, 15);

    const overflow = await fetch(
      `${baseUrl}/api/outings/${created.outing.outing.id}/items`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "열여섯 번째" }),
      },
    );
    assert.equal(overflow.status, 409);

    const single = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "준비물 한 개",
        placeId: "gwangalli",
        startsAt: futureStartsAt(4, "10:00"),
        creatorName: "테스터",
        itemKeys: ["water"],
        customItems: [],
      }),
    }).then((response) => response.json());
    const removeLast = await fetch(
      `${baseUrl}/api/outings/${single.outing.outing.id}/items/${single.outing.items[0].id}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${single.session.token}`,
        },
      },
    );
    assert.equal(removeLast.status, 409);
  });
});

test("메인 혼잡 슬라이더에 한강공원 실시간 인구를 제공한다", async () => {
  let crowdCalls = 0;
  const fetchImpl = async (url) => {
    assert.match(url, /citydata_ppltn/);
    crowdCalls += 1;
    return new Response(
      JSON.stringify({
        SeoulRtd: {
          row: [
            {
              AREA_CONGEST_LVL: "보통",
              AREA_CONGEST_MSG: "여유 공간을 찾을 수 있어요.",
              AREA_PPLTN_MIN: "1500",
              AREA_PPLTN_MAX: "2000",
              PPLTN_TIME: "2026-07-29 08:20",
              FCST_PPLTN: [
                {
                  FCST_TIME: "2026-07-29 09:00",
                  FCST_CONGEST_LVL: "약간 붐빔",
                  FCST_PPLTN_MIN: "2300",
                  FCST_PPLTN_MAX: "2800",
                },
              ],
            },
          ],
        },
      }),
      { status: 200 },
    );
  };

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/crowd-highlights`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.places.length, 4);
      assert.equal(crowdCalls, 4);
      assert.ok(
        payload.places.every(
          (place) =>
            place.currentCrowd.mode === "live" &&
            place.currentCrowd.populationRange === "1,500~2,000명" &&
            place.currentCrowd.observedAt === "2026-07-29T08:20:00+09:00",
        ),
      );
      // 5분 동안은 같은 결과를 다시 쓰고 서울시 API를 부르지 않아요.
      const cachedResponse = await fetch(`${baseUrl}/api/crowd-highlights`);
      assert.equal(cachedResponse.status, 200);
      assert.equal(crowdCalls, 4);
    },
    { seoulOpenDataApiKey: "secret", fetchImpl },
  );
});

test("장소 목록에 여름 인기 워터파크와 방문 정보를 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/places`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const waterparks = payload.places.filter(
      (place) => place.category === "waterpark",
    );

    assert.deepEqual(
      waterparks.map((place) => place.id),
      ["caribbean-bay", "ocean-world", "gimhae-lotte-waterpark"],
    );
    assert.ok(
      waterparks.every(
        (place) =>
          place.highlights.length === 3 &&
          place.tagline &&
          place.summerTip &&
          place.imageUrl.startsWith("/assets/waterpark-") &&
          place.officialUrl.startsWith("https://") &&
          place.currentCrowd.mode === "estimate",
      ),
    );
  });
});

test("한강과 워터파크 외 여름 모임 장소를 다양하게 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/places`);
    const payload = await response.json();
    const summerPlaceIds = [
      "songjeong-beach",
      "baegun-valley",
      "seoul-forest",
    ];
    const summerPlaces = payload.places.filter((place) =>
      summerPlaceIds.includes(place.id),
    );

    assert.equal(summerPlaces.length, 3);
    assert.deepEqual(
      summerPlaces.map((place) => place.category),
      ["beach", "valley", "park"],
    );
    assert.ok(
      summerPlaces.every(
        (place) =>
          place.tagline &&
          place.highlights.length === 3 &&
          place.summerTip &&
          place.officialUrl.startsWith("https://"),
      ),
    );
  });
});

test("활동 유형에 맞는 스마트 준비물을 추천한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/packing-recommendations?activityType=festival&placeId=yeouido-hangang&startsAt=${encodeURIComponent(futureStartsAt(3, "10:00"))}&expectedPeople=6`,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.activityType, "festival");
    assert.ok(
      result.recommendations.some((item) => item.key === "ticket"),
    );
    assert.ok(
      result.recommendations.some((item) => item.key === "battery"),
    );
    assert.equal(
      result.recommendations.find((item) => item.key === "ticket")
        .quantityLabel,
      "6명 기준 6장",
    );
    assert.equal(
      result.recommendations.find((item) => item.key === "battery")
        .quantityLabel,
      "6명 기준 3개",
    );
  });
});

test("장소 혼잡도를 구분해 보여주고 AI 행사 출처를 검증해 캐시한다", async () => {
  let openAiCalls = 0;
  const officialUrl =
    "https://www.visitbusan.net/schedule/view.do?boardId=BBS_0000009";
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    openAiCalls += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.tools[0].type, "web_search");
    assert.equal(request.tool_choice, "required");
    assert.deepEqual(request.include, [
      "web_search_call.action.sources",
    ]);
    return new Response(
      JSON.stringify({
        status: "completed",
        model: "gpt-5.6-2026-07-01",
        output: [
          {
            type: "web_search_call",
            action: {
              type: "search",
              sources: [
                {
                  type: "url",
                  url: officialUrl,
                  title: "Visit Busan 행사 안내",
                },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  headline: "광안리에서 여름밤을 즐겨요",
                  searchSummary: "모임 날짜와 가까운 공식 행사를 확인했어요.",
                  events: [
                    {
                      title: "광안리 M 드론라이트쇼",
                      dateLabel: "2026년 여름 매주 토요일",
                      venue: "광안리 해변",
                      why: "준비를 마친 뒤 함께 보기 좋아요.",
                      sourceTitle: "Visit Busan",
                      sourceUrl: "https://www.visitbusan.net/schedule/view.do",
                    },
                    {
                      title: "출처 없는 가짜 행사",
                      dateLabel: "2026년 8월",
                      venue: "광안리",
                      why: "가짜예요.",
                      sourceTitle: "가짜",
                      sourceUrl: "https://example.com/fake",
                    },
                  ],
                  noEventMessage: "",
                }),
                annotations: [
                  {
                    type: "url_citation",
                    url: officialUrl,
                    title: "Visit Busan 행사 안내",
                  },
                ],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 80,
          total_tokens: 180,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  await withServer(
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/outings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "광안리 여름밤",
          placeId: "gwangalli",
          startsAt: futureStartsAt(7, "19:00"),
          activityType: "festival",
          expectedPeople: 4,
          creatorName: "현우",
          itemKeys: ["water", "battery"],
        }),
      }).then((response) => response.json());
      const outingId = created.outing.outing.id;
      const headers = {
        authorization: `Bearer ${created.session.token}`,
      };

      const intelligenceResponse = await fetch(
        `${baseUrl}/api/outings/${outingId}/place-intelligence`,
        { headers },
      );
      assert.equal(intelligenceResponse.status, 200);
      const intelligence = await intelligenceResponse.json();
      assert.equal(intelligence.crowd.mode, "estimate");
      assert.match(intelligence.crowd.label, /예상/);
      assert.equal(intelligence.crowd.source.url, null);

      const firstResponse = await fetch(
        `${baseUrl}/api/outings/${outingId}/summer-events`,
        { method: "POST", headers },
      );
      assert.equal(firstResponse.status, 201);
      const first = await firstResponse.json();
      assert.equal(first.events.events.length, 1);
      assert.equal(first.events.events[0].sourceUrl, officialUrl);
      assert.equal(first.meta.cached, false);

      const secondResponse = await fetch(
        `${baseUrl}/api/outings/${outingId}/summer-events`,
        { method: "POST", headers },
      );
      assert.equal(secondResponse.status, 200);
      assert.equal((await secondResponse.json()).meta.cached, true);
      assert.equal(openAiCalls, 1);
    },
    {
      openAiApiKey: "test-key",
      fetchImpl,
    },
  );
});

test("AI 브리핑은 참여자만 생성하고 같은 준비 상태에서는 캐시한다", async () => {
  const openAiRequests = [];
  const briefing = {
    teamAlias: "선크림 지휘대",
    headline: "준비는 반짝, 물 담당은 아직 공석",
    verdict: "핵심 준비는 잘됐지만 물 담당을 먼저 정하면 마음이 놓여요.",
    actions: [
      {
        kind: "assign",
        title: "물 담당 정하기",
        reason: "아직 주인이 없어 출발 직전 빠질 가능성이 커요.",
        targetItemKey: "water",
      },
      {
        kind: "weather",
        title: "그늘 자리 확인하기",
        reason: "한낮 야외 일정이라 쉬어갈 곳을 미리 정하면 좋아요.",
        targetItemKey: null,
      },
    ],
    plotTwist: "모두의 가방은 완벽한데 물만 혼자 자유여행 중이에요.",
    shareCaption: "우리 팀 AI 진단은 ‘선크림 지휘대’! 물 담당 한 명만 구해요.",
  };
  const fetchImpl = async (url, options) => {
    openAiRequests.push({ url, options });
    return new Response(
      JSON.stringify({
        status: "completed",
        model: "gpt-5.6-terra",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(briefing),
              },
            ],
          },
        ],
        usage: {
          input_tokens: 321,
          output_tokens: 104,
          total_tokens: 425,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  await withServer(
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/outings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "AI 한강 피크닉",
          placeId: "yeouido-hangang",
          startsAt: futureStartsAt(8, "14:00"),
          activityType: "picnic",
          expectedPeople: 4,
          creatorName: "민감한닉네임",
          itemKeys: ["water", "hat"],
          customItems: [],
        }),
      }).then((response) => response.json());
      const outingId = created.outing.outing.id;
      const endpoint = `${baseUrl}/api/outings/${outingId}/ai-briefing`;

      const unauthorized = await fetch(endpoint, { method: "POST" });
      assert.equal(unauthorized.status, 403);

      const first = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      });
      assert.equal(first.status, 201);
      const firstResult = await first.json();
      assert.deepEqual(firstResult.briefing, briefing);
      assert.equal(firstResult.meta.cached, false);

      const second = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.session.token}`,
        },
      });
      assert.equal(second.status, 200);
      assert.equal((await second.json()).meta.cached, true);
      assert.equal(openAiRequests.length, 1);

      const request = openAiRequests[0];
      const body = JSON.parse(request.options.body);
      assert.equal(request.url, "https://api.openai.com/v1/responses");
      assert.equal(
        request.options.headers.authorization,
        "Bearer test-openai-key",
      );
      assert.equal(body.model, "gpt-5.6-terra");
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, "none");
      assert.equal(body.text.format.strict, true);
      assert.equal(request.options.body.includes("민감한닉네임"), false);
    },
    {
      fetchImpl,
      openAiApiKey: "test-openai-key",
    },
  );
});

test("번들에 장소 분류·지난 모임·권한·인원 기준 수량을 담는다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl, {
      placeId: "caribbean-bay",
      activityType: "water-play",
      expectedPeople: 2,
      avatarKey: "type-chill",
      customItems: ["보드게임"],
    });
    const bundle = created.outing;
    assert.equal(bundle.outing.placeCategory, "waterpark");
    assert.equal(
      bundle.outing.placeImageUrl,
      "/assets/waterpark-caribbean-bay-v1.webp",
    );
    assert.equal(bundle.outing.isPast, false);
    assert.match(bundle.outing.startsAt, /^\d{4}-\d{2}-\d{2}T14:00:00\+09:00$/);
    assert.equal(bundle.isCreator, true);
    assert.equal(bundle.canDelete, true);
    assert.equal(bundle.maxParticipants, 30);
    assert.equal(bundle.weatherStatus, "unavailable");
    assert.equal(bundle.participants[0].avatarKey, "type-chill");
    assert.equal(
      bundle.items.find((item) => item.label === "보드게임").quantityLabel,
      "1개",
    );
    assert.equal(
      bundle.items.find((item) => item.key === "water").quantityLabel,
      "2명 기준 4병",
    );

    for (const name of ["하나", "둘", "셋"]) {
      const joined = await joinTestOuting(baseUrl, created, name, {
        avatarKey: name === "하나" ? "type-foodie" : "not-allowed",
      });
      assert.equal(joined.status, 201);
    }
    const view = await call(baseUrl, `/api/outings/${bundle.outing.id}`, {
      token: created.session.token,
    });
    assert.deepEqual(
      view.body.participants.map((participant) => participant.avatarKey),
      ["type-chill", "type-foodie", "junho", "seoyeon"],
    );
    // 예상 인원(2명)보다 실제 참여자(4명)가 많으면 참여자 수로 계산해요.
    assert.equal(
      view.body.items.find((item) => item.key === "water").quantityLabel,
      "4명 기준 8병",
    );
    assert.ok(
      view.body.smartRecommendations.some(
        (item) => item.key === "waterproof-pouch",
      ),
    );

    const custom = await createTestOuting(baseUrl, {
      placeId: "custom:33.49962:126.53119",
      customPlace: {
        name: "제주시, 제주특별자치도",
        latitude: 33.49962,
        longitude: 126.53119,
      },
    });
    assert.equal(custom.outing.outing.placeCategory, null);
    assert.equal(custom.outing.outing.placeImageUrl, null);
  });
});

test("최근 친구 소식은 30개까지 보여준다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl);
    const item = created.outing.items.find((entry) => entry.key === "water");
    for (let index = 0; index < 34; index += 1) {
      const result = await call(
        baseUrl,
        `/api/outings/${created.outing.outing.id}/items/${item.id}`,
        {
          method: "PATCH",
          token: created.session.token,
          body: { done: index % 2 === 0 },
        },
      );
      assert.equal(result.status, 200);
    }
    const view = await call(
      baseUrl,
      `/api/outings/${created.outing.outing.id}`,
      { token: created.session.token },
    );
    assert.equal(view.body.events.length, 30);
    assert.equal(view.body.events[0].type, "reopened");
  });
});

test("모임 날짜는 오늘부터 365일 안의 한국 시간으로 정규화한다", async () => {
  await withServer(async (baseUrl) => {
    const base = {
      title: "날짜 검증",
      placeId: "seoul-forest",
      creatorName: "테스터",
      itemKeys: ["water"],
    };
    for (const startsAt of [
      futureStartsAt(-1),
      futureStartsAt(366),
      "다음 주 토요일",
      "2027-02-30T10:00:00+09:00",
      undefined,
    ]) {
      const result = await call(baseUrl, "/api/outings", {
        method: "POST",
        body: { ...base, startsAt },
      });
      assert.equal(result.status, 400, String(startsAt));
      assert.deepEqual(result.body, {
        error: "모임 날짜를 다시 확인해 주세요.",
        code: "invalid_date",
      });
    }

    // UTC로 보내도 한국 날짜·시간으로 저장해요.
    const kstDate = addDaysToDateKey(getKoreaDateKey(), 5);
    const utcDate = addDaysToDateKey(kstDate, -1);
    const created = await call(baseUrl, "/api/outings", {
      method: "POST",
      body: { ...base, startsAt: `${utcDate}T16:30:45.000Z` },
    });
    assert.equal(created.status, 201);
    assert.equal(
      created.body.outing.outing.startsAt,
      `${kstDate}T01:30:00+09:00`,
    );

    for (const expectedPeople of [0, -3, 2.5, "2.5", "많이", "3명", true]) {
      const result = await call(baseUrl, "/api/outings", {
        method: "POST",
        body: { ...base, startsAt: futureStartsAt(2), expectedPeople },
      });
      assert.equal(result.status, 400, String(expectedPeople));
      assert.equal(result.body.code, "invalid_people");
    }
    // 이미 출시된 앱은 999명까지 보낼 수 있어 생성은 50명으로 맞춰 받아요.
    for (const [expectedPeople, stored] of [
      [51, 50],
      [999, 50],
      ["120", 50],
      ["7", 7],
    ]) {
      const result = await call(baseUrl, "/api/outings", {
        method: "POST",
        body: { ...base, startsAt: futureStartsAt(2), expectedPeople },
      });
      assert.equal(result.status, 201, String(expectedPeople));
      assert.equal(result.body.outing.outing.expectedPeople, stored);
    }
    const defaulted = await call(baseUrl, "/api/outings", {
      method: "POST",
      body: { ...base, startsAt: futureStartsAt(2) },
    });
    assert.equal(defaulted.body.outing.outing.expectedPeople, 2);

    const preview = await call(
      baseUrl,
      `/api/packing-recommendations?activityType=picnic&placeId=seoul-forest&startsAt=${encodeURIComponent(futureStartsAt(2))}&expectedPeople=999`,
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.expectedPeople, 50);
  });
});

test("담당자 맡기·해제·완료·삭제 권한을 지킨다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl, {
      itemKeys: ["water", "mat", "hat", "camera"],
    });
    const outingId = created.outing.outing.id;
    const creator = created.session;
    const first = (await joinTestOuting(baseUrl, created, "민지")).body.session;
    const second = (await joinTestOuting(baseUrl, created, "준호")).body
      .session;
    const item = created.outing.items.find((entry) => entry.key === "mat");
    const itemPath = `/api/outings/${outingId}/items/${item.id}`;
    const patch = (session, body) =>
      call(baseUrl, itemPath, {
        method: "PATCH",
        token: session.token,
        body,
      });
    const ownerOf = async () =>
      (
        await call(baseUrl, `/api/outings/${outingId}`, {
          token: creator.token,
        })
      ).body.items.find((entry) => entry.id === item.id);

    assert.equal((await patch(first, { ownerId: first.participantId })).status, 200);
    const conflict = await patch(second, { ownerId: second.participantId });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, {
      error: "이미 민지님이 맡은 준비물이에요.",
      code: "already_claimed",
    });

    const doneByOther = await patch(second, { done: true });
    assert.equal(doneByOther.status, 403);
    assert.deepEqual(doneByOther.body, {
      error: "담당자만 준비 상태를 바꿀 수 있어요.",
      code: "forbidden",
    });
    assert.equal((await patch(first, { done: true })).status, 200);
    // 이미 내 담당이면 다시 맡아도 완료 상태가 그대로예요.
    assert.equal((await patch(first, { ownerId: first.participantId })).status, 200);
    assert.equal((await ownerOf()).done, true);

    const unassignByOther = await patch(second, { ownerId: null });
    assert.equal(unassignByOther.status, 403);
    assert.deepEqual(unassignByOther.body, {
      error: "담당자나 모임을 만든 사람만 바꿀 수 있어요.",
      code: "forbidden",
    });

    // 담당자는 다른 친구에게 넘길 수 있어요.
    assert.equal((await patch(first, { ownerId: second.participantId })).status, 200);
    const handedOff = await ownerOf();
    assert.equal(handedOff.owner.id, second.participantId);
    assert.equal(handedOff.done, false);
    assert.equal((await patch(first, { ownerId: null })).status, 403);
    assert.equal(
      (await patch(first, { ownerId: first.participantId })).status,
      409,
    );

    // 모임을 만든 사람은 누구의 담당이든 바꿀 수 있어요.
    assert.equal((await patch(creator, { ownerId: null })).status, 200);
    const afterUnassign = await call(baseUrl, `/api/outings/${outingId}`, {
      token: creator.token,
    });
    assert.equal(afterUnassign.body.events[0].type, "unassigned");
    assert.equal(afterUnassign.body.events[0].participant.id, creator.participantId);
    assert.equal((await patch(creator, { ownerId: first.participantId })).status, 200);
    assert.equal((await patch(creator, { ownerId: creator.participantId })).status, 200);
    assert.equal((await ownerOf()).owner.id, creator.participantId);
    assert.equal((await patch(first, { ownerId: second.participantId })).status, 403);

    const invalidOwner = await patch(creator, { ownerId: "pt_not_here" });
    assert.equal(invalidOwner.status, 400);
    assert.equal(invalidOwner.body.code, "invalid_owner");

    // 삭제: 담당자 없는 준비물 · 내 준비물 · 만든 사람만 지울 수 있어요.
    const water = created.outing.items.find((entry) => entry.key === "water");
    const deniedDelete = await call(
      baseUrl,
      `/api/outings/${outingId}/items/${water.id}`,
      { method: "DELETE", token: second.token },
    );
    assert.equal(deniedDelete.status, 403);
    assert.equal(deniedDelete.body.code, "forbidden");
    const camera = created.outing.items.find((entry) => entry.key === "camera");
    assert.equal(
      (
        await call(baseUrl, `/api/outings/${outingId}/items/${camera.id}`, {
          method: "DELETE",
          token: second.token,
        })
      ).status,
      200,
    );

    const completeNothing = await call(
      baseUrl,
      `/api/outings/${outingId}/complete-mine`,
      { method: "POST", token: second.token },
    );
    assert.equal(completeNothing.body.completed, 0);
    const eventsAfter = (
      await call(baseUrl, `/api/outings/${outingId}`, { token: creator.token })
    ).body.events;
    assert.equal(
      eventsAfter.some((event) => event.type === "completed_mine"),
      false,
    );

    const randomized = await call(baseUrl, `/api/outings/${outingId}/randomize`, {
      method: "POST",
      token: creator.token,
    });
    assert.equal(randomized.status, 200);
    assert.equal(randomized.body.assigned, 1);
  });
});

test("마지막 준비물은 지울 수 없다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl, { itemKeys: ["hat"] });
    const result = await call(
      baseUrl,
      `/api/outings/${created.outing.outing.id}/items/${created.outing.items[0].id}`,
      { method: "DELETE", token: created.session.token },
    );
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
      error: "준비물은 하나 이상 있어야 해요.",
      code: "last_item",
    });
  });
});

test("모임 정보는 만든 사람만 수정하고 날짜·장소가 바뀌면 날씨를 새로 받는다", async () => {
  const counter = { calls: 0 };
  await withServer(
    async (baseUrl) => {
      const created = await createTestOuting(baseUrl, {
        startsAt: futureStartsAt(3),
      });
      const outingId = created.outing.outing.id;
      assert.equal(created.outing.weatherStatus, "ok");
      assert.equal(counter.calls, 1);
      const friend = (await joinTestOuting(baseUrl, created, "친구")).body
        .session;
      const path = `/api/outings/${outingId}`;

      const denied = await call(baseUrl, path, {
        method: "PATCH",
        token: friend.token,
        body: { title: "친구가 바꾼 이름" },
      });
      assert.equal(denied.status, 403);
      assert.deepEqual(denied.body, {
        error: "모임을 만든 사람만 수정할 수 있어요.",
        code: "not_creator",
      });
      const anonymous = await call(baseUrl, path, {
        method: "PATCH",
        body: { title: "누군가" },
      });
      assert.equal(anonymous.status, 403);

      const renamed = await call(baseUrl, path, {
        method: "PATCH",
        token: created.session.token,
        body: { title: "  새 이름의   모임 ", expectedPeople: 6 },
      });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.outing.outing.title, "새 이름의 모임");
      assert.equal(renamed.body.outing.outing.expectedPeople, 6);
      assert.equal(renamed.body.outing.events[0].type, "updated");
      assert.equal(renamed.body.outing.events[0].itemLabel, null);
      assert.equal(
        renamed.body.outing.items.find((item) => item.key === "water")
          .quantityLabel,
        "6명 기준 12병",
      );
      assert.equal(counter.calls, 1);

      const moved = await call(baseUrl, path, {
        method: "PATCH",
        token: created.session.token,
        body: { startsAt: futureStartsAt(4, "18:00"), placeId: "gwangalli" },
      });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.outing.outing.placeId, "gwangalli");
      assert.equal(moved.body.outing.outing.placeCategory, "beach");
      assert.equal(moved.body.outing.outing.startsAt, futureStartsAt(4, "18:00"));
      assert.equal(counter.calls, 2);

      for (const [body, code] of [
        [{ startsAt: futureStartsAt(-3) }, "invalid_date"],
        [{ expectedPeople: 0 }, "invalid_people"],
        // 수정은 새 앱만 보내므로 1~50명만 받아요.
        [{ expectedPeople: 51 }, "invalid_people"],
        [{ title: "a" }, "invalid_outing"],
        [{ placeId: "nowhere" }, "invalid_outing"],
        [{}, "invalid_outing"],
      ]) {
        const result = await call(baseUrl, path, {
          method: "PATCH",
          token: created.session.token,
          body,
        });
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.body.code, code);
      }
    },
    { weatherEnabled: true, fetchImpl: forecastStub(counter) },
  );
});

test("초대 링크를 새로 만들면 예전 링크는 더 이상 쓸 수 없다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl);
    const outingId = created.outing.outing.id;
    const oldCode = created.outing.outing.inviteCode;
    const friend = (await joinTestOuting(baseUrl, created, "친구")).body
      .session;

    const denied = await call(baseUrl, `/api/outings/${outingId}/invite-code`, {
      method: "POST",
      token: friend.token,
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "not_creator");

    const reset = await call(baseUrl, `/api/outings/${outingId}/invite-code`, {
      method: "POST",
      token: created.session.token,
    });
    assert.equal(reset.status, 200);
    assert.ok(reset.body.inviteCode);
    assert.notEqual(reset.body.inviteCode, oldCode);

    const staleJoin = await joinTestOuting(baseUrl, created, "늦은친구");
    assert.equal(staleJoin.status, 403);
    assert.equal(staleJoin.body.code, "invalid_invite");
    const staleView = await call(
      baseUrl,
      `/api/outings/${outingId}?invite=${encodeURIComponent(oldCode)}`,
    );
    assert.equal(staleView.status, 403);
    const freshView = await call(
      baseUrl,
      `/api/outings/${outingId}?invite=${encodeURIComponent(reset.body.inviteCode)}`,
    );
    assert.equal(freshView.status, 200);
    assert.equal(freshView.body.viewer, null);
    assert.equal(freshView.body.isCreator, false);

    const friendView = await call(baseUrl, `/api/outings/${outingId}`, {
      token: friend.token,
    });
    assert.equal(friendView.status, 200);
    assert.equal(friendView.body.outing.inviteCode, reset.body.inviteCode);
  });
});

test("참여는 30명까지이고 같은 익명 사용자는 기존 참여자로 다시 들어온다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl, {
      itemKeys: ["water", "mat", "hat"],
    });
    const outingId = created.outing.outing.id;
    const mat = created.outing.items.find((item) => item.key === "mat");
    const hat = created.outing.items.find((item) => item.key === "hat");

    const claimed = await joinTestOuting(
      baseUrl,
      created,
      "돗자리",
      { claimItemId: mat.id },
      { userKey: "join-user-1" },
    );
    assert.equal(claimed.status, 201);
    assert.equal(claimed.body.claimResult, "claimed");
    assert.equal(
      claimed.body.outing.items.find((item) => item.id === mat.id).owner.id,
      claimed.body.session.participantId,
    );

    const again = await joinTestOuting(
      baseUrl,
      created,
      "다시왔어요",
      { claimItemId: mat.id },
      { userKey: "join-user-1" },
    );
    assert.equal(again.status, 200);
    assert.equal(
      again.body.session.participantId,
      claimed.body.session.participantId,
    );
    assert.ok(again.body.session.token);
    assert.notEqual(again.body.session.token, claimed.body.session.token);
    assert.equal(again.body.claimResult, "claimed");
    assert.equal(again.body.outing.participants.length, 2);
    const oldToken = await call(baseUrl, `/api/outings/${outingId}`, {
      token: claimed.body.session.token,
    });
    assert.equal(oldToken.status, 403);
    const newToken = await call(baseUrl, `/api/outings/${outingId}`, {
      token: again.body.session.token,
    });
    assert.equal(newToken.body.viewer.id, claimed.body.session.participantId);

    const taken = await joinTestOuting(baseUrl, created, "늦게", {
      claimItemId: mat.id,
    });
    assert.equal(taken.body.claimResult, "taken");
    const noClaim = await joinTestOuting(baseUrl, created, "그냥");
    assert.equal(noClaim.body.claimResult, "none");
    const missingClaim = await joinTestOuting(baseUrl, created, "없는거", {
      claimItemId: "item_missing",
    });
    assert.equal(missingClaim.body.claimResult, "none");
    assert.equal(
      (
        await joinTestOuting(baseUrl, created, "모자", {
          claimItemId: hat.id,
        })
      ).body.claimResult,
      "claimed",
    );

    // 지금 6명이에요. 30명까지 채워요.
    for (let index = 6; index < 30; index += 1) {
      const result = await joinTestOuting(baseUrl, created, `친구${index}`);
      assert.equal(result.status, 201, `join ${index}`);
    }
    const full = await joinTestOuting(baseUrl, created, "서른하나");
    assert.equal(full.status, 409);
    assert.deepEqual(full.body, {
      error: "모임 인원이 가득 찼어요.",
      code: "outing_full",
    });
    // 이미 참여한 사람은 인원이 차도 다시 들어올 수 있어요.
    const rejoin = await joinTestOuting(
      baseUrl,
      created,
      "돗자리",
      {},
      { userKey: "join-user-1" },
    );
    assert.equal(rejoin.status, 200);
    assert.equal(rejoin.body.outing.participants.length, 30);
  });
});

test("바뀐 게 없으면 ETag로 304를 돌려준다", async () => {
  await withServer(async (baseUrl) => {
    const created = await createTestOuting(baseUrl);
    const outingId = created.outing.outing.id;
    const path = `/api/outings/${outingId}`;
    const firstView = await call(baseUrl, path, {
      token: created.session.token,
    });
    assert.equal(firstView.status, 200);
    const etag = firstView.headers.get("etag");
    assert.equal(
      etag,
      `W/"0-0-${created.session.participantId}"`,
    );
    assert.equal(firstView.headers.get("cache-control"), "private, no-cache");
    assert.match(
      firstView.headers.get("access-control-expose-headers"),
      /etag/i,
    );

    const preflight = await call(baseUrl, path, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-headers"),
      /if-none-match/,
    );
    // 10초 폴링마다 preflight가 다시 가지 않게 10분 동안 재사용해요.
    assert.equal(preflight.headers.get("access-control-max-age"), "600");

    const notModified = await call(baseUrl, path, {
      token: created.session.token,
      headers: { "if-none-match": etag },
    });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.text, "");
    assert.equal(notModified.headers.get("etag"), etag);

    const friend = await joinTestOuting(baseUrl, created, "친구");
    const friendView = await call(baseUrl, path, {
      token: friend.body.session.token,
      headers: { "if-none-match": etag },
    });
    assert.equal(friendView.status, 200);

    const afterJoin = await call(baseUrl, path, {
      token: created.session.token,
      headers: { "if-none-match": etag },
    });
    assert.equal(afterJoin.status, 200);
    const joinedEtag = afterJoin.headers.get("etag");
    assert.notEqual(joinedEtag, etag);

    const item = created.outing.items.find((entry) => entry.owner == null);
    await call(baseUrl, `${path}/items/${item.id}`, {
      method: "PATCH",
      token: created.session.token,
      body: { done: true },
    });
    const afterPatch = await call(baseUrl, path, {
      token: created.session.token,
      headers: { "if-none-match": joinedEtag },
    });
    assert.equal(afterPatch.status, 200);
    assert.equal(afterPatch.body.items.find((entry) => entry.id === item.id).done, true);
  });
});

test("예보 범위 밖이면 날씨 API를 부르지 않고 실패는 잠시 기억한다", async () => {
  const counter = { calls: 0 };
  await withServer(
    async (baseUrl) => {
      const far = await createTestOuting(baseUrl, {
        startsAt: futureStartsAt(30),
      });
      assert.equal(far.outing.weather, null);
      assert.equal(far.outing.weatherStatus, "out_of_range");
      const preview = await call(
        baseUrl,
        `/api/packing-recommendations?activityType=picnic&placeId=seoul-forest&startsAt=${encodeURIComponent(futureStartsAt(40))}`,
      );
      assert.equal(preview.body.weatherStatus, "out_of_range");
      assert.equal(preview.body.weather, null);
      assert.equal(counter.calls, 0);
    },
    { weatherEnabled: true, fetchImpl: forecastStub(counter) },
  );

  const failing = { calls: 0 };
  await withServer(
    async (baseUrl) => {
      const created = await createTestOuting(baseUrl, {
        startsAt: futureStartsAt(2),
      });
      assert.equal(created.outing.weather, null);
      assert.equal(created.outing.weatherStatus, "unavailable");
      assert.equal(failing.calls, 1);
      const again = await call(
        baseUrl,
        `/api/outings/${created.outing.outing.id}`,
        { token: created.session.token },
      );
      assert.equal(again.body.weatherStatus, "unavailable");
      assert.equal(failing.calls, 1);
    },
    {
      weatherEnabled: true,
      fetchImpl: forecastStub(failing, { fail: true }),
    },
  );
});

test("지난 모임은 AI 기능을 막고 내 모임 목록은 다가오는 순서로 보여준다", async () => {
  let clock = Date.now();
  let openAiCalls = 0;
  const fetchImpl = async () => {
    openAiCalls += 1;
    throw new Error("OpenAI must not be called");
  };
  await withServer(
    async (baseUrl) => {
      const userKey = "ordering-user";
      const make = (title, days) =>
        createTestOuting(
          baseUrl,
          { title, startsAt: futureStartsAt(days) },
          { userKey },
        );
      const a = await make("하루 뒤", 1);
      const b = await make("이틀 뒤", 2);
      const c = await make("여드레 뒤", 8);
      const d = await make("열이틀 뒤", 12);
      const e = await make("한 달 뒤", 30);

      clock += 5 * 24 * 60 * 60 * 1000;

      const sessions = (
        await call(baseUrl, "/api/me/outings", { userKey })
      ).body.sessions;
      assert.deepEqual(
        sessions.map((session) => session.title),
        ["여드레 뒤", "열이틀 뒤", "한 달 뒤", "이틀 뒤", "하루 뒤"],
      );
      assert.deepEqual(
        sessions.map((session) => session.isPast),
        [false, false, false, true, true],
      );
      assert.ok([a, b, c, d, e].every(Boolean));

      const pastView = await call(
        baseUrl,
        `/api/outings/${a.outing.outing.id}`,
        { userKey },
      );
      assert.equal(pastView.body.outing.isPast, true);
      assert.equal(pastView.body.weatherStatus, "past");

      for (const endpoint of ["ai-briefing", "summer-events"]) {
        const result = await call(
          baseUrl,
          `/api/outings/${a.outing.outing.id}/${endpoint}`,
          { method: "POST", userKey },
        );
        assert.equal(result.status, 409);
        assert.deepEqual(result.body, {
          error: "이미 지난 모임이에요.",
          code: "outing_past",
        });
      }
      assert.equal(openAiCalls, 0);
    },
    { fetchImpl, openAiApiKey: "test-key", now: () => clock },
  );
});

test("여러 모임 요약을 한 번에 가볍게 돌려준다", async () => {
  await withServer(async (baseUrl) => {
    const userKey = "summary-user";
    const first = await createTestOuting(baseUrl, {
      title: "첫 모임",
      itemKeys: ["water", "mat", "hat"],
    });
    const second = await createTestOuting(
      baseUrl,
      { title: "둘째 모임", itemKeys: ["mat", "hat"] },
      { userKey },
    );
    const friend = await joinTestOuting(baseUrl, first, "친구", {
      claimItemId: first.outing.items.find((item) => item.key === "mat").id,
    });

    const result = await call(baseUrl, "/api/outing-summaries", {
      method: "POST",
      userKey,
      body: {
        sessions: [
          { outingId: first.outing.outing.id, token: first.session.token },
          { outingId: second.outing.outing.id, token: "" },
          { outingId: "out_missing", token: "nope" },
          { outingId: first.outing.outing.id, token: "wrong-token" },
        ],
      },
    });
    assert.equal(result.status, 200);
    // 모임 행이 없는 outingId만 missing에 담아요.
    assert.deepEqual(result.body.missing, ["out_missing"]);
    assert.deepEqual(result.body.summaries, [
      {
        outingId: first.outing.outing.id,
        title: "첫 모임",
        placeName: "서울숲",
        startsAt: first.outing.outing.startsAt,
        ready: 0,
        total: 3,
        unassigned: 1,
        myOpen: 1,
        canDelete: true,
        isPast: false,
      },
      {
        outingId: second.outing.outing.id,
        title: "둘째 모임",
        placeName: "서울숲",
        startsAt: second.outing.outing.startsAt,
        ready: 0,
        total: 2,
        unassigned: 2,
        myOpen: 0,
        canDelete: true,
        isPast: false,
      },
    ]);

    const friendSummary = await call(baseUrl, "/api/outing-summaries", {
      method: "POST",
      body: {
        sessions: [
          { outingId: first.outing.outing.id, token: friend.body.session.token },
        ],
      },
    });
    assert.equal(friendSummary.body.summaries[0].canDelete, false);
    assert.equal(friendSummary.body.summaries[0].myOpen, 1);

    // 권한만 없는 모임은 요약에서 빠지지만 missing에는 넣지 않아요.
    // 지운 모임은 missing으로 알려줘 앱이 목록에서 정리할 수 있어요.
    const deleted = await call(baseUrl, `/api/outings/${second.outing.outing.id}`, {
      method: "DELETE",
      token: second.session.token,
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await call(baseUrl, "/api/outing-summaries", {
      method: "POST",
      body: {
        sessions: [
          { outingId: first.outing.outing.id, token: "not-a-member" },
          { outingId: second.outing.outing.id, token: second.session.token },
        ],
      },
    });
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(afterDelete.body.summaries, []);
    assert.deepEqual(afterDelete.body.missing, [second.outing.outing.id]);
    const empty = await call(baseUrl, "/api/outing-summaries", {
      method: "POST",
      body: { sessions: [] },
    });
    assert.deepEqual(empty.body, { summaries: [], missing: [] });

    // 토큰으로 요약을 읽으면 익명 사용자 키도 연결돼 내 모임에 보여요
    // (둘째 모임은 위에서 지웠어요).
    const linked = await call(baseUrl, "/api/me/outings", { userKey });
    assert.deepEqual(
      linked.body.sessions.map((session) => session.outingId),
      [first.outing.outing.id],
    );
  });
});

test("하루 요청 한도를 넘으면 429를 돌려준다", async () => {
  await withServer(async (baseUrl) => {
    for (let index = 0; index < 20; index += 1) {
      await createTestOuting(baseUrl, { title: `한도 ${index}` }, {
        userKey: "busy-user",
      });
    }
    const limited = await call(baseUrl, "/api/outings", {
      method: "POST",
      userKey: "busy-user",
      body: {
        title: "한도 초과",
        placeId: "seoul-forest",
        startsAt: futureStartsAt(3),
        creatorName: "모임장",
      },
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, {
      error: "오늘은 요청이 너무 많아요. 내일 다시 시도해 주세요.",
      code: "rate_limited",
    });
    // 다른 사용자는 영향을 받지 않아요.
    await createTestOuting(baseUrl, {}, { userKey: "calm-user" });
  });
});

test("AI 브리핑은 실패한 시도도 모임별 하루 한도에 포함한다", async () => {
  let openAiCalls = 0;
  const fetchImpl = async () => {
    openAiCalls += 1;
    return new Response(JSON.stringify({ error: { code: "server_error" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };
  await withServer(
    async (baseUrl) => {
      const created = await createTestOuting(baseUrl);
      const endpoint = `/api/outings/${created.outing.outing.id}/ai-briefing`;
      for (let index = 0; index < 8; index += 1) {
        const result = await call(baseUrl, endpoint, {
          method: "POST",
          token: created.session.token,
        });
        assert.equal(result.status, 502);
        assert.equal(result.body.code, "ai_failed");
      }
      const limited = await call(baseUrl, endpoint, {
        method: "POST",
        token: created.session.token,
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.body.code, "daily_limit");
      assert.equal(openAiCalls, 8);
    },
    { fetchImpl, openAiApiKey: "test-key" },
  );
});

test("모임 혼잡도는 오늘이 아니면 모임 시각 기준으로 예상한다", async () => {
  await withServer(async (baseUrl) => {
    const later = await createTestOuting(baseUrl, {
      placeId: "gwangalli",
      startsAt: futureStartsAt(6, "19:00"),
    });
    // 이미 출시된 앱(플래그 없음)은 예전처럼 '지금' 혼잡도를 받아요.
    const legacyCrowd = await call(
      baseUrl,
      `/api/outings/${later.outing.outing.id}/place-intelligence`,
      { token: later.session.token },
    );
    assert.equal(legacyCrowd.status, 200);
    assert.equal(legacyCrowd.body.crowd.basis, "now");
    assert.match(legacyCrowd.body.crowd.summary, /^지금은/);

    const laterCrowd = await call(
      baseUrl,
      `/api/outings/${later.outing.outing.id}/place-intelligence?basis=outing`,
      { token: later.session.token },
    );
    assert.equal(laterCrowd.status, 200);
    assert.equal(laterCrowd.body.crowd.basis, "outing");
    assert.equal(laterCrowd.body.crowd.targetTime, futureStartsAt(6, "19:00"));
    assert.match(laterCrowd.body.crowd.summary, /^모임 시간에는/);
    assert.match(laterCrowd.body.crowd.observedAt, /\+09:00$/);

    const today = await createTestOuting(baseUrl, {
      placeId: "gwangalli",
      startsAt: futureStartsAt(0, "23:00"),
    });
    // 오늘 모임은 플래그가 있어도 '지금' 혼잡도예요.
    const todayCrowd = await call(
      baseUrl,
      `/api/outings/${today.outing.outing.id}/place-intelligence?basis=outing`,
      { token: today.session.token },
    );
    assert.equal(todayCrowd.body.crowd.basis, "now");
    assert.match(todayCrowd.body.crowd.targetTime, /\+09:00$/);
    assert.match(todayCrowd.body.crowd.summary, /^지금은/);

    const places = await call(baseUrl, "/api/places");
    assert.ok(
      places.body.places.every((place) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(
          place.currentCrowd.observedAt,
        ),
      ),
    );
  });
});

test("사용자 키를 바꿔 가며 보내도 같은 IP에서는 IP 한도에 막힌다", async () => {
  const { ipLimit } = RATE_LIMITS.createOuting;
  const body = {
    title: "한도 초과",
    placeId: "seoul-forest",
    startsAt: futureStartsAt(3),
    creatorName: "모임장",
    itemKeys: ["water"],
  };
  await withServer(async (baseUrl) => {
    for (let index = 0; index < ipLimit; index += 1) {
      await createTestOuting(
        baseUrl,
        { title: `키 바꾸기 ${index}` },
        { userKey: `rotating-${index}` },
      );
    }
    // 새 사용자 키라도 같은 IP라면 막혀요. TRUST_PROXY가 꺼져 있으면
    // 프록시 헤더를 바꿔 보내도 소켓 주소로 세요.
    const rotated = await call(baseUrl, "/api/outings", {
      method: "POST",
      userKey: "rotating-new",
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "cf-connecting-ip": "203.0.113.9",
      },
      body,
    });
    assert.equal(rotated.status, 429);
    assert.deepEqual(rotated.body, {
      error: "오늘은 요청이 너무 많아요. 내일 다시 시도해 주세요.",
      code: "rate_limited",
    });
    // 사용자 키를 빼고 보내도 같은 IP 버킷이에요.
    const keyless = await call(baseUrl, "/api/outings", {
      method: "POST",
      body,
    });
    assert.equal(keyless.status, 429);
  });

  // TRUST_PROXY=1이면 믿는 프록시가 X-Forwarded-For 오른쪽에 덧붙인 값으로
  // 세요. 클라이언트가 보낸 왼쪽 값이나 CF-Connecting-IP를 바꿔도 버킷을
  // 고를 수 없어요.
  await withServer(
    async (baseUrl) => {
      const viaProxy = (spoofed, peer, userKey) =>
        call(baseUrl, "/api/outings", {
          method: "POST",
          userKey,
          headers: {
            "x-forwarded-for": `${spoofed}, ${peer}`,
            "cf-connecting-ip": spoofed,
          },
          body,
        });
      for (let index = 0; index < ipLimit; index += 1) {
        const result = await viaProxy(
          `10.${index}.0.1`,
          "198.51.100.7",
          `proxy-${index}`,
        );
        assert.equal(result.status, 201, JSON.stringify(result.body));
      }
      assert.equal(
        (await viaProxy("10.250.0.1", "198.51.100.7", "proxy-new")).status,
        429,
      );
      assert.equal(
        (await viaProxy("10.250.0.1", "198.51.100.8", "proxy-new")).status,
        201,
      );
    },
    { trustProxy: true },
  );
});

test("IPv6는 /64 단위로 세고 TRUST_PROXY=cloudflare일 때만 CF-Connecting-IP를 믿는다", async () => {
  const { ipLimit } = RATE_LIMITS.createOuting;
  const body = {
    title: "IPv6 한도",
    placeId: "seoul-forest",
    startsAt: futureStartsAt(3),
    creatorName: "모임장",
    itemKeys: ["water"],
  };
  await withServer(
    async (baseUrl) => {
      const fromIp = (ip, userKey) =>
        call(baseUrl, "/api/outings", {
          method: "POST",
          userKey,
          // cloudflare 모드에서는 X-Forwarded-For를 보지 않아요.
          headers: {
            "cf-connecting-ip": ip,
            "x-forwarded-for": "198.51.100.200",
          },
          body,
        });
      // 같은 /64 안에서 주소와 사용자 키를 함께 바꿔도 한 버킷이에요.
      for (let index = 0; index < ipLimit; index += 1) {
        const result = await fromIp(
          `2001:db8:1:2:${index.toString(16)}::${index + 1}`,
          `v6-${index}`,
        );
        assert.equal(result.status, 201, JSON.stringify(result.body));
      }
      const limited = await fromIp("2001:db8:1:2:ffff::1", "v6-new");
      assert.equal(limited.status, 429);
      assert.equal(limited.body.code, "rate_limited");
      assert.equal((await fromIp("2001:db8:1:3::1", "v6-new")).status, 201);
      assert.equal((await fromIp("192.0.2.1", "v4-new")).status, 201);
    },
    { trustProxy: "cloudflare" },
  );
});

test("AI 브리핑과 행사 검색은 서비스 전체 하루 OpenAI 한도를 함께 쓴다", async () => {
  let openAiCalls = 0;
  const fetchImpl = async () => {
    openAiCalls += 1;
    return new Response(JSON.stringify({ error: { code: "server_error" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };
  await withServer(
    async (baseUrl) => {
      const first = await createTestOuting(baseUrl);
      const second = await createTestOuting(baseUrl, {}, { userKey: "other" });
      const briefing = (created) =>
        call(baseUrl, `/api/outings/${created.outing.outing.id}/ai-briefing`, {
          method: "POST",
          token: created.session.token,
        });
      assert.equal((await briefing(first)).status, 502);
      assert.equal((await briefing(first)).status, 502);

      // 다른 모임·다른 사용자라도 전체 한도가 다 차면 막혀요.
      const limited = await briefing(second);
      assert.equal(limited.status, 429);
      assert.deepEqual(limited.body, {
        error: "오늘은 AI 브리핑 이용이 많아 마감됐어요. 내일 다시 시도해 주세요.",
        code: "daily_limit",
      });
      const events = await call(
        baseUrl,
        `/api/outings/${second.outing.outing.id}/summer-events`,
        { method: "POST", token: second.session.token },
      );
      assert.equal(events.status, 429);
      assert.deepEqual(events.body, {
        error: "오늘은 AI 행사 검색 이용이 많아 마감됐어요. 내일 다시 찾아볼게요.",
        code: "daily_limit",
      });
      assert.equal(openAiCalls, 2);
    },
    { fetchImpl, openAiApiKey: "test-key", aiGlobalDailyLimit: "2" },
  );
});

test("날씨 갱신이 실패하면 이전 예보를 지키고 10분 뒤 다시 시도한다", async () => {
  let clock = Date.now();
  let failing = false;
  const counter = { calls: 0 };
  const succeed = forecastStub(counter);
  const fetchImpl = async (url, options) => {
    if (!failing) return succeed(url, options);
    counter.calls += 1;
    throw new Error("timeout");
  };
  await withServer(
    async (baseUrl) => {
      const created = await createTestOuting(baseUrl, {
        startsAt: futureStartsAt(3),
      });
      const path = `/api/outings/${created.outing.outing.id}`;
      const token = created.session.token;
      assert.equal(created.outing.weatherStatus, "ok");
      const goodWeather = created.outing.weather;
      assert.ok(goodWeather);
      assert.equal(counter.calls, 1);

      failing = true;
      clock += 31 * 60 * 1000;
      const stale = await call(baseUrl, path, { token });
      assert.equal(stale.body.weatherStatus, "ok");
      assert.deepEqual(stale.body.weather, goodWeather);
      assert.equal(counter.calls, 2);

      // 실패 직후에는 다시 부르지 않고, 지킨 예보로 304도 돌려줘요.
      clock += 5 * 60 * 1000;
      const soon = await call(baseUrl, path, { token });
      assert.deepEqual(soon.body.weather, goodWeather);
      assert.equal(counter.calls, 2);
      const notModified = await call(baseUrl, path, {
        token,
        headers: { "if-none-match": soon.headers.get("etag") },
      });
      assert.equal(notModified.status, 304);

      clock += 6 * 60 * 1000;
      const retried = await call(baseUrl, path, { token });
      assert.deepEqual(retried.body.weather, goodWeather);
      assert.equal(retried.body.weatherStatus, "ok");
      assert.equal(counter.calls, 3);

      failing = false;
      clock += 11 * 60 * 1000;
      const recovered = await call(baseUrl, path, { token });
      assert.equal(recovered.body.weatherStatus, "ok");
      assert.equal(counter.calls, 4);
    },
    { weatherEnabled: true, fetchImpl, now: () => clock },
  );
});

test("날씨를 받는 사이 날짜가 바뀌거나 모임이 지워지면 캐시를 쓰지 않는다", async () => {
  let clock = Date.now();
  const counter = { calls: 0 };
  const succeed = forecastStub(counter);
  let hold = null;
  const fetchImpl = async (url, options) => {
    const gate = hold;
    hold = null;
    if (gate) {
      gate.started();
      await gate.released;
    }
    return succeed(url, options);
  };
  const holdNextFetch = () => {
    const gate = {};
    const started = new Promise((resolve) => {
      gate.started = resolve;
    });
    gate.released = new Promise((resolve) => {
      gate.release = resolve;
    });
    hold = gate;
    return { started, release: () => gate.release() };
  };
  const dateIn = (days) => addDaysToDateKey(getKoreaDateKey(), days);

  await withServer(
    async (baseUrl) => {
      const created = await createTestOuting(baseUrl, {
        startsAt: futureStartsAt(3),
      });
      const path = `/api/outings/${created.outing.outing.id}`;
      const token = created.session.token;
      assert.equal(created.outing.weather.date, dateIn(3));

      // 오래된 캐시를 갱신하는 GET이 Open-Meteo를 기다리는 동안 날짜를 바꿔요.
      clock += 31 * 60 * 1000;
      const gate = holdNextFetch();
      const slowGet = call(baseUrl, path, { token });
      await gate.started;
      const moved = await call(baseUrl, path, {
        method: "PATCH",
        token,
        body: { startsAt: futureStartsAt(5) },
      });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.outing.weather.date, dateIn(5));
      gate.release();
      assert.equal((await slowGet).status, 200);

      const after = await call(baseUrl, path, { token });
      assert.equal(after.body.outing.startsAt, futureStartsAt(5));
      assert.equal(after.body.weather.date, dateIn(5));

      // 갱신 중에 모임이 지워져도 FK 오류 없이 끝나요.
      clock += 31 * 60 * 1000;
      const deleteGate = holdNextFetch();
      const slowGetBeforeDelete = call(baseUrl, path, { token });
      await deleteGate.started;
      const removed = await call(baseUrl, path, { method: "DELETE", token });
      assert.equal(removed.status, 200);
      deleteGate.release();
      assert.equal((await slowGetBeforeDelete).status, 200);
      assert.equal((await call(baseUrl, path, { token })).status, 404);
    },
    { weatherEnabled: true, fetchImpl, now: () => clock },
  );
});

test("예전 서버가 저장한 50명 초과 인원은 50명으로 맞춘다", async () => {
  const legacyRow = {
    id: "out_legacy",
    invite_code: "invite",
    title: "예전 모임",
    place_id: "seoul-forest",
    place_name: "서울숲",
    latitude: 37.5444,
    longitude: 127.0374,
    starts_at: futureStartsAt(3),
    activity_type: "picnic",
    created_at: new Date().toISOString(),
  };
  assert.equal(
    mapOutingRow({ ...legacyRow, expected_people: 120 }).expectedPeople,
    50,
  );
  assert.equal(
    mapOutingRow({ ...legacyRow, expected_people: null }).expectedPeople,
    2,
  );

  // Node 저장소도 시작할 때 D1 마이그레이션(0005)처럼 값을 맞춰요.
  const dir = mkdtempSync(join(tmpdir(), "chaengyeosum-people-"));
  const dbFile = join(dir, "legacy.db");
  try {
    let created;
    await withServer(
      async (baseUrl) => {
        created = await createTestOuting(baseUrl);
      },
      { dbFile, cleanupIntervalMs: 0 },
    );
    const outingId = created.outing.outing.id;
    const legacy = new DatabaseSync(dbFile);
    legacy
      .prepare("UPDATE outings SET expected_people = 120 WHERE id = ?")
      .run(outingId);
    legacy.close();

    await withServer(
      async (baseUrl) => {
        const view = await call(baseUrl, `/api/outings/${outingId}`, {
          token: created.session.token,
        });
        assert.equal(view.body.outing.expectedPeople, 50);
      },
      { dbFile, cleanupIntervalMs: 0 },
    );
    const check = new DatabaseSync(dbFile);
    assert.equal(
      check
        .prepare("SELECT expected_people FROM outings WHERE id = ?")
        .get(outingId).expected_people,
      50,
    );
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
