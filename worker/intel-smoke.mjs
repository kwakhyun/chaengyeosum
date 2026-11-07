import assert from "node:assert/strict";

function futureStartsAt(daysAhead, time) {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const date = new Date(kstNow.getTime() + daysAhead * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${date}T${time}:00+09:00`;
}

const baseUrl = (
  process.env.API_BASE_URL ??
  "https://chaengyeosum-api.kwakhyun-miniapps.workers.dev"
).replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${response.status} ${payload.error ?? JSON.stringify(payload)}`,
    );
  }
  return { response, payload };
}

const created = await request("/api/outings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "장소 인텔리전스 점검",
    placeId: "gwangalli",
    startsAt: futureStartsAt(6, "19:00"),
    activityType: "festival",
    expectedPeople: 4,
    creatorName: "점검봇",
    itemKeys: ["water", "battery"],
  }),
});

const outingId = created.payload.outing.outing.id;
const headers = {
  authorization: `Bearer ${created.payload.session.token}`,
};
const intelligence = await request(
  `/api/outings/${encodeURIComponent(outingId)}/place-intelligence`,
  { headers },
);
assert.ok(["live", "estimate"].includes(intelligence.payload.crowd.mode));
assert.ok(intelligence.payload.crowd.label);

const events = await request(
  `/api/outings/${encodeURIComponent(outingId)}/summer-events`,
  { method: "POST", headers },
);
assert.ok(Array.isArray(events.payload.events.events));
for (const event of events.payload.events.events) {
  const source = new URL(event.sourceUrl);
  assert.ok(source.protocol === "https:" || source.protocol === "http:");
  assert.ok(event.title);
  assert.ok(event.dateLabel);
}

console.log(
  JSON.stringify({
    ok: true,
    crowdMode: intelligence.payload.crowd.mode,
    crowdLabel: intelligence.payload.crowd.label,
    eventCount: events.payload.events.events.length,
    eventTitles: events.payload.events.events.map((event) => event.title),
    cached: events.payload.meta.cached,
  }),
);
