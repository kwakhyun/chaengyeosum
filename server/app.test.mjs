import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createApiServer } from "./app.mjs";

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
        startsAt: "2026-08-02T14:00:00+09:00",
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
    const firstItem = created.outing.items[0];
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
        startsAt: "2026-08-06T10:00:00+09:00",
        activityType: "trip",
        expectedPeople: 6,
        creatorName: "테스터",
        itemKeys: ["water", "battery"],
      }),
    }).then((response) => response.json());

    assert.equal(created.outing.outing.placeName, "제주시, 제주특별자치도");
    assert.equal(created.outing.outing.latitude, 33.49962);
    assert.equal(created.outing.outing.expectedPeople, 6);
    assert.equal(
      created.outing.items.find((item) => item.key === "battery")
        .quantityLabel,
      "6명 기준 3개",
    );
  });
});

test("초대 코드나 참여 토큰이 없으면 모임을 읽을 수 없다", async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/outings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "비공개 물놀이",
        placeId: "gwangalli",
        startsAt: "2026-08-03T10:00:00+09:00",
        creatorName: "서연",
      }),
    }).then((response) => response.json());

    const response = await fetch(
      `${baseUrl}/api/outings/${created.outing.outing.id}`,
    );
    assert.equal(response.status, 403);
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
        startsAt: "2026-08-04T10:00:00+09:00",
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
        startsAt: "2026-08-05T10:00:00+09:00",
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
            place.currentCrowd.populationRange === "1,500~2,000명",
        ),
      );
    },
    { seoulOpenDataApiKey: "secret", fetchImpl },
  );
});

test("활동 유형에 맞는 스마트 준비물을 추천한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/packing-recommendations?activityType=festival&placeId=yeouido-hangang&startsAt=2026-08-04T10%3A00%3A00%2B09%3A00&expectedPeople=6`,
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
          startsAt: "2026-08-08T19:00:00+09:00",
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
          startsAt: "2026-08-09T14:00:00+09:00",
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
