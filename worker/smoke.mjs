import assert from "node:assert/strict";

const baseUrl = process.env.WORKER_API_URL ?? "http://127.0.0.1:8790";

function futureStartsAt(daysAhead, time = "10:00") {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const date = new Date(kstNow.getTime() + daysAhead * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${date}T${time}:00+09:00`;
}

async function raw(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

async function request(path, options = {}) {
  const { response, body } = await raw(path, options);
  assert.equal(
    response.ok,
    true,
    `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
  );
  return body;
}

const health = await request("/api/health");
assert.equal(health.storage, "cloudflare-d1");

// 10초 폴링마다 preflight가 다시 가지 않게 10분 동안 재사용해요.
const preflight = await fetch(`${baseUrl}/api/outings/out_any`, {
  method: "OPTIONS",
  headers: {
    origin: "https://example.com",
    "access-control-request-method": "GET",
    "access-control-request-headers": "authorization, if-none-match",
  },
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-max-age"), "600");

const anonymousUserKey = `worker-smoke-${Date.now()}`;
const created = await request("/api/outings", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-chaengyeosum-user-key": anonymousUserKey,
  },
  body: JSON.stringify({
    title: "Cloudflare 배포 검증",
    placeId: "custom:33.49962:126.53119",
    customPlace: {
      id: "custom:33.49962:126.53119",
      name: "제주시, 제주특별자치도",
      latitude: 33.49962,
      longitude: 126.53119,
    },
    startsAt: futureStartsAt(5),
    activityType: "trip",
    expectedPeople: 6,
    creatorName: "검증이",
    avatarKey: "type-planner",
    itemKeys: ["water", "battery", "camera", "hat"],
  }),
});
assert.equal(created.outing.outing.expectedPeople, 6);
assert.equal(created.outing.isCreator, true);
assert.equal(created.outing.maxParticipants, 30);
assert.equal(created.outing.participants[0].avatarKey, "type-planner");
assert.match(created.outing.outing.startsAt, /T10:00:00\+09:00$/);
assert.ok(
  ["ok", "unavailable"].includes(created.outing.weatherStatus),
  created.outing.weatherStatus,
);
assert.equal(
  created.outing.items.find((item) => item.key === "water").quantityLabel,
  "6명 기준 12병",
);

const pastDate = await raw("/api/outings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "지난 날짜 모임",
    placeId: "seoul-forest",
    startsAt: futureStartsAt(-2),
    creatorName: "검증이",
  }),
});
assert.equal(pastDate.response.status, 400);
assert.equal(pastDate.body.code, "invalid_date");

// 이미 출시된 앱은 999명까지 보낼 수 있어 생성은 50명으로 맞춰 받아요.
const crowded = await request("/api/outings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "큰 모임",
    placeId: "seoul-forest",
    startsAt: futureStartsAt(20),
    expectedPeople: 999,
    creatorName: "검증이",
    itemKeys: ["water"],
  }),
});
assert.equal(crowded.outing.outing.expectedPeople, 50);

const recovered = await request("/api/me/outings", {
  headers: { "x-chaengyeosum-user-key": anonymousUserKey },
});
assert.equal(
  recovered.sessions.some(
    (session) => session.outingId === created.outing.outing.id,
  ),
  true,
);

const outingId = created.outing.outing.id;
const creatorAuth = { authorization: `Bearer ${created.session.token}` };
const joined = await request(`/api/outings/${outingId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inviteCode: created.outing.outing.inviteCode,
    name: "친구",
  }),
});
assert.equal(joined.outing.participants.length, 2);
assert.equal(joined.claimResult, "none");
const friendAuth = { authorization: `Bearer ${joined.session.token}` };

// 참여하면서 준비물을 맡으면 이벤트·revision이 함께 반영돼요.
const hatItem = joined.outing.items.find((item) => item.key === "hat");
const claimer = await request(`/api/outings/${outingId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inviteCode: created.outing.outing.inviteCode,
    name: "모자",
    claimItemId: hatItem.id,
  }),
});
assert.equal(claimer.claimResult, "claimed");
assert.equal(
  claimer.outing.items.find((item) => item.id === hatItem.id).owner.id,
  claimer.session.participantId,
);
assert.equal(claimer.outing.events[0].type, "claimed");
const claimerAuth = { authorization: `Bearer ${claimer.session.token}` };

const unassigned = joined.outing.items.find((item) => item.owner == null);
await request(`/api/outings/${outingId}/items/${unassigned.id}`, {
  method: "PATCH",
  headers: { ...friendAuth, "content-type": "application/json" },
  body: JSON.stringify({
    ownerId: joined.session.participantId,
    done: true,
  }),
});
const afterClaim = await request(`/api/outings/${outingId}`, {
  headers: friendAuth,
});
assert.deepEqual(
  afterClaim.events.slice(0, 2).map((item) => item.type),
  ["completed", "claimed"],
);

// 내 준비물 모두 완료: 남은 게 있을 때만 이벤트를 남겨요.
const completed = await request(`/api/outings/${outingId}/complete-mine`, {
  method: "POST",
  headers: claimerAuth,
});
assert.equal(completed.completed, 1);
const completedAgain = await request(`/api/outings/${outingId}/complete-mine`, {
  method: "POST",
  headers: claimerAuth,
});
assert.equal(completedAgain.completed, 0);
const afterComplete = await request(`/api/outings/${outingId}`, {
  headers: claimerAuth,
});
assert.equal(
  afterComplete.events.filter((item) => item.type === "completed_mine").length,
  1,
);

// 준비물을 추가했다 지우면 삭제 이벤트가 함께 남아요.
const added = await request(`/api/outings/${outingId}/items`, {
  method: "POST",
  headers: { ...creatorAuth, "content-type": "application/json" },
  body: JSON.stringify({ label: "지울 준비물" }),
});
await request(`/api/outings/${outingId}/items/${added.itemId}`, {
  method: "DELETE",
  headers: creatorAuth,
});
const afterDelete = await request(`/api/outings/${outingId}`, {
  headers: creatorAuth,
});
assert.equal(afterDelete.events[0].type, "item_deleted");
assert.equal(afterDelete.events[0].itemLabel, "지울 준비물");
assert.equal(
  afterDelete.items.some((item) => item.id === added.itemId),
  false,
);

// 다른 사람이 맡은 준비물은 가져갈 수 없어요.
const creatorsItem = joined.outing.items.find((item) => item.key === "water");
const conflict = await raw(
  `/api/outings/${outingId}/items/${creatorsItem.id}`,
  {
    method: "PATCH",
    headers: { ...friendAuth, "content-type": "application/json" },
    body: JSON.stringify({ ownerId: joined.session.participantId }),
  },
);
assert.equal(conflict.response.status, 409);
assert.equal(conflict.body.code, "already_claimed");
assert.match(conflict.body.error, /검증이님이 맡은/);

// ETag: 바뀐 게 없으면 304, 바뀌면 다시 200이에요.
const etagView = await raw(`/api/outings/${outingId}`, {
  headers: creatorAuth,
});
assert.equal(etagView.response.status, 200);
const etag = etagView.response.headers.get("etag");
assert.match(etag ?? "", /^W\/"\d+-\d+-pt_/);
const notModified = await fetch(`${baseUrl}/api/outings/${outingId}`, {
  headers: { ...creatorAuth, "if-none-match": etag },
});
assert.equal(notModified.status, 304);
assert.equal(await notModified.text(), "");

const creatorView = etagView.body;
const event = creatorView.events[0];
await request(`/api/outings/${outingId}/events/${event.id}/reaction`, {
  method: "POST",
  headers: { ...creatorAuth, "content-type": "application/json" },
  body: JSON.stringify({ reactionType: "heart" }),
});

const reacted = await raw(`/api/outings/${outingId}`, {
  headers: { ...creatorAuth, "if-none-match": etag },
});
assert.equal(reacted.response.status, 200);
assert.notEqual(reacted.response.headers.get("etag"), etag);
assert.equal(
  reacted.body.events.find((item) => item.id === event.id).reactions.heart,
  1,
);

// 모임 수정은 만든 사람만 할 수 있어요.
const deniedPatch = await raw(`/api/outings/${outingId}`, {
  method: "PATCH",
  headers: { ...friendAuth, "content-type": "application/json" },
  body: JSON.stringify({ title: "친구가 바꾼 이름" }),
});
assert.equal(deniedPatch.response.status, 403);
assert.equal(deniedPatch.body.code, "not_creator");

const patched = await request(`/api/outings/${outingId}`, {
  method: "PATCH",
  headers: { ...creatorAuth, "content-type": "application/json" },
  body: JSON.stringify({
    title: "제주 여름 마무리",
    expectedPeople: 8,
    startsAt: futureStartsAt(40, "11:30"),
  }),
});
assert.equal(patched.outing.outing.title, "제주 여름 마무리");
assert.equal(patched.outing.outing.expectedPeople, 8);
assert.equal(patched.outing.weatherStatus, "out_of_range");
assert.equal(patched.outing.weather, null);
assert.equal(patched.outing.events[0].type, "updated");

const unassignedBefore = patched.outing.items.filter(
  (item) => item.owner == null,
).length;
const randomized = await request(`/api/outings/${outingId}/randomize`, {
  method: "POST",
  headers: creatorAuth,
});
assert.equal(randomized.assigned, unassignedBefore);

const finalView = await request(`/api/outings/${outingId}`, {
  headers: creatorAuth,
});
assert.equal(
  finalView.items.every((item) => item.owner != null),
  true,
);
assert.equal(finalView.events[0].type, "randomized");
assert.equal(finalView.events[0].itemLabel, String(unassignedBefore));

// 출시된 앱(플래그 없음)은 '지금' 혼잡도, 새 앱은 모임 시각 기준 예상이에요.
const crowdNow = await request(
  `/api/outings/${outingId}/place-intelligence`,
  { headers: creatorAuth },
);
assert.equal(crowdNow.crowd.basis, "now");
const crowdAtOuting = await request(
  `/api/outings/${outingId}/place-intelligence?basis=outing`,
  { headers: creatorAuth },
);
assert.equal(crowdAtOuting.crowd.basis, "outing");

const summaries = await request("/api/outing-summaries", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sessions: [
      { outingId, token: created.session.token },
      { outingId: "out_missing", token: "nope" },
    ],
  }),
});
assert.equal(summaries.summaries.length, 1);
assert.deepEqual(summaries.missing, ["out_missing"]);
assert.equal(summaries.summaries[0].outingId, outingId);
assert.equal(summaries.summaries[0].total, finalView.items.length);
assert.equal(summaries.summaries[0].canDelete, true);
assert.equal(summaries.summaries[0].isPast, false);

// 초대 링크를 새로 만들면 예전 링크로는 참여할 수 없어요.
const reset = await request(`/api/outings/${outingId}/invite-code`, {
  method: "POST",
  headers: creatorAuth,
});
assert.notEqual(reset.inviteCode, created.outing.outing.inviteCode);
const staleJoin = await raw(`/api/outings/${outingId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inviteCode: created.outing.outing.inviteCode,
    name: "늦은친구",
  }),
});
assert.equal(staleJoin.response.status, 403);

console.log(
  JSON.stringify({
    ok: true,
    service: health.service,
    storage: health.storage,
    outingId,
    participants: finalView.participants.length,
    items: finalView.items.length,
    etag,
  }),
);
