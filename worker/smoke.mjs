import assert from "node:assert/strict";

const baseUrl = process.env.WORKER_API_URL ?? "http://127.0.0.1:8790";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  assert.equal(
    response.ok,
    true,
    `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
  );
  return body;
}

const health = await request("/api/health");
assert.equal(health.storage, "cloudflare-d1");

const created = await request("/api/outings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "Cloudflare 배포 검증",
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
    creatorName: "검증이",
    itemKeys: ["water", "battery", "camera"],
  }),
});
assert.equal(created.outing.outing.expectedPeople, 6);
assert.equal(
  created.outing.items.find((item) => item.key === "water").quantityLabel,
  "6명 기준 12병",
);

const outingId = created.outing.outing.id;
const joined = await request(`/api/outings/${outingId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inviteCode: created.outing.outing.inviteCode,
    name: "친구",
  }),
});
assert.equal(joined.outing.participants.length, 2);

const unassigned = joined.outing.items.find((item) => item.owner == null);
await request(`/api/outings/${outingId}/items/${unassigned.id}`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${joined.session.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    ownerId: joined.session.participantId,
    done: true,
  }),
});

const creatorView = await request(`/api/outings/${outingId}`, {
  headers: { authorization: `Bearer ${created.session.token}` },
});
const event = creatorView.events[0];
await request(`/api/outings/${outingId}/events/${event.id}/reaction`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${created.session.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ reactionType: "heart" }),
});

const reactedView = await request(`/api/outings/${outingId}`, {
  headers: { authorization: `Bearer ${created.session.token}` },
});
assert.equal(
  reactedView.events.find((item) => item.id === event.id).reactions.heart,
  1,
);

await request(`/api/outings/${outingId}/randomize`, {
  method: "POST",
  headers: { authorization: `Bearer ${created.session.token}` },
});

const finalView = await request(`/api/outings/${outingId}`, {
  headers: { authorization: `Bearer ${created.session.token}` },
});
assert.equal(
  finalView.items.every((item) => item.owner != null),
  true,
);

console.log(
  JSON.stringify({
    ok: true,
    service: health.service,
    storage: health.storage,
    outingId,
    participants: finalView.participants.length,
    items: finalView.items.length,
  }),
);
