import assert from "node:assert/strict";

const baseUrl =
  process.env.WORKER_API_URL ??
  "https://chaengyeosum-api.kwakhyun-miniapps.workers.dev";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  assert.equal(
    response.ok,
    true,
    `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
  );
  return { body, status: response.status };
}

const created = await request("/api/outings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "AI 브리핑 배포 검증",
    placeId: "yeouido-hangang",
    startsAt: "2026-08-09T14:00:00+09:00",
    activityType: "picnic",
    expectedPeople: 4,
    creatorName: "배포검증",
    itemKeys: ["water", "hat", "sunscreen", "mat", "camera"],
  }),
});
const outingId = created.body.outing.outing.id;
const token = created.body.session.token;
const endpoint = `/api/outings/${outingId}/ai-briefing`;
const headers = { authorization: `Bearer ${token}` };

const first = await request(endpoint, { method: "POST", headers });
assert.equal(first.status, 201);
assert.equal(first.body.meta.cached, false);
assert.equal(first.body.briefing.actions.length, 2);
assert.ok(first.body.briefing.teamAlias);
assert.ok(first.body.briefing.shareCaption);

const second = await request(endpoint, { method: "POST", headers });
assert.equal(second.status, 200);
assert.equal(second.body.meta.cached, true);
assert.deepEqual(second.body.briefing, first.body.briefing);

console.log(
  JSON.stringify({
    ok: true,
    outingId,
    inviteCode: created.body.outing.outing.inviteCode,
    model: first.body.meta.model,
    cachedOnSecondRequest: second.body.meta.cached,
    teamAlias: first.body.briefing.teamAlias,
  }),
);
