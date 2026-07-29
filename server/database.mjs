import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MAX_ITEMS } from "./item-options.mjs";
import {
  getSuggestedQuantity,
  normalizeExpectedPeople,
} from "./smart-packing.mjs";

const AVATAR_KEYS = ["me", "minji", "junho", "seoyeon"];

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createOpaqueId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createToken() {
  return randomBytes(24).toString("base64url");
}

function createInviteCode() {
  return randomBytes(7).toString("base64url");
}

export function createStore(filename) {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS outings (
      id TEXT PRIMARY KEY,
      invite_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      place_id TEXT NOT NULL,
      place_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      starts_at TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT 'picnic',
      expected_people INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      avatar_key TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      anonymous_user_hash TEXT,
      joined_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS participants_outing_idx
      ON participants(outing_id);

    CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      label TEXT NOT NULL,
      image TEXT NOT NULL,
      owner_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS checklist_outing_idx
      ON checklist_items(outing_id, sort_order);

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
      participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      item_label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS activity_events_outing_idx
      ON activity_events(outing_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS weather_cache (
      outing_id TEXT PRIMARY KEY REFERENCES outings(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_reactions (
      event_id TEXT NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (event_id, participant_id)
    );

    CREATE INDEX IF NOT EXISTS event_reactions_event_idx
      ON event_reactions(event_id);
  `);

  const outingColumns = db.prepare("PRAGMA table_info(outings)").all();
  if (!outingColumns.some((column) => column.name === "activity_type")) {
    db.exec(
      "ALTER TABLE outings ADD COLUMN activity_type TEXT NOT NULL DEFAULT 'picnic'",
    );
  }
  if (!outingColumns.some((column) => column.name === "expected_people")) {
    db.exec(
      "ALTER TABLE outings ADD COLUMN expected_people INTEGER NOT NULL DEFAULT 2",
    );
  }
  const participantColumns = db.prepare("PRAGMA table_info(participants)").all();
  if (
    !participantColumns.some(
      (column) => column.name === "anonymous_user_hash",
    )
  ) {
    db.exec("ALTER TABLE participants ADD COLUMN anonymous_user_hash TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS participants_outing_anonymous_idx
      ON participants(outing_id, anonymous_user_hash)
      WHERE anonymous_user_hash IS NOT NULL
  `);

  const statements = {
    insertOuting: db.prepare(`
      INSERT INTO outings (
        id, invite_code, title, place_id, place_name,
        latitude, longitude, starts_at, activity_type, expected_people, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertParticipant: db.prepare(`
      INSERT INTO participants (
        id, outing_id, name, avatar_key, token_hash,
        anonymous_user_hash, joined_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertItem: db.prepare(`
      INSERT INTO checklist_items (
        id, outing_id, item_key, label, image, owner_id, done, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `),
    getOuting: db.prepare("SELECT * FROM outings WHERE id = ?"),
    getParticipants: db.prepare(`
      SELECT id, name, avatar_key, joined_at
      FROM participants
      WHERE outing_id = ?
      ORDER BY joined_at ASC
    `),
    getItems: db.prepare(`
      SELECT id, item_key, label, image, owner_id, done, sort_order
      FROM checklist_items
      WHERE outing_id = ?
      ORDER BY sort_order ASC
    `),
    getUnassignedItems: db.prepare(`
      SELECT id, label
      FROM checklist_items
      WHERE outing_id = ? AND owner_id IS NULL
      ORDER BY sort_order ASC
    `),
    getOwnerCounts: db.prepare(`
      SELECT owner_id, COUNT(*) AS count
      FROM checklist_items
      WHERE outing_id = ? AND owner_id IS NOT NULL
      GROUP BY owner_id
    `),
    getEvents: db.prepare(`
      SELECT id, participant_id, event_type, item_label, created_at
      FROM activity_events
      WHERE outing_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 8
    `),
    insertEvent: db.prepare(`
      INSERT INTO activity_events (
        id, outing_id, participant_id, event_type, item_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    getEvent: db.prepare(`
      SELECT id FROM activity_events WHERE id = ? AND outing_id = ?
    `),
    getReactions: db.prepare(`
      SELECT event_id, participant_id, reaction_type
      FROM event_reactions
      WHERE event_id IN (
        SELECT id FROM activity_events WHERE outing_id = ?
      )
    `),
    getReaction: db.prepare(`
      SELECT reaction_type FROM event_reactions
      WHERE event_id = ? AND participant_id = ?
    `),
    upsertReaction: db.prepare(`
      INSERT INTO event_reactions (
        event_id, participant_id, reaction_type, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id, participant_id) DO UPDATE SET
        reaction_type = excluded.reaction_type,
        created_at = excluded.created_at
    `),
    deleteReaction: db.prepare(`
      DELETE FROM event_reactions
      WHERE event_id = ? AND participant_id = ?
    `),
    getParticipantByToken: db.prepare(`
      SELECT id, outing_id, name, avatar_key, joined_at
      FROM participants
      WHERE token_hash = ?
    `),
    getParticipantByAnonymousUser: db.prepare(`
      SELECT id, outing_id, name, avatar_key, joined_at
      FROM participants
      WHERE anonymous_user_hash = ? AND outing_id = ?
    `),
    getSessionsByAnonymousUser: db.prepare(`
      SELECT
        participants.id AS participant_id,
        outings.id AS outing_id,
        outings.title,
        outings.place_name,
        outings.starts_at,
        outings.activity_type
      FROM participants
      JOIN outings ON outings.id = participants.outing_id
      WHERE participants.anonymous_user_hash = ?
      ORDER BY outings.created_at DESC
      LIMIT 20
    `),
    linkAnonymousUser: db.prepare(`
      UPDATE participants
      SET anonymous_user_hash = ?
      WHERE id = ?
        AND anonymous_user_hash IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM participants AS existing
          WHERE existing.outing_id = ?
            AND existing.anonymous_user_hash = ?
        )
    `),
    getParticipant: db.prepare(`
      SELECT id, outing_id, name, avatar_key, joined_at
      FROM participants
      WHERE id = ? AND outing_id = ?
    `),
    participantCount: db.prepare(`
      SELECT COUNT(*) AS count FROM participants WHERE outing_id = ?
    `),
    getItem: db.prepare(`
      SELECT * FROM checklist_items WHERE id = ? AND outing_id = ?
    `),
    getItemByKey: db.prepare(`
      SELECT * FROM checklist_items WHERE item_key = ? AND outing_id = ?
    `),
    getItemByLabel: db.prepare(`
      SELECT * FROM checklist_items WHERE label = ? AND outing_id = ?
    `),
    itemCount: db.prepare(`
      SELECT COUNT(*) AS count FROM checklist_items WHERE outing_id = ?
    `),
    nextSortOrder: db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM checklist_items
      WHERE outing_id = ?
    `),
    updateDone: db.prepare(`
      UPDATE checklist_items SET done = ? WHERE id = ? AND outing_id = ?
    `),
    updateOwner: db.prepare(`
      UPDATE checklist_items SET owner_id = ?, done = 0
      WHERE id = ? AND outing_id = ?
    `),
    completeMine: db.prepare(`
      UPDATE checklist_items SET done = 1
      WHERE outing_id = ? AND owner_id = ?
    `),
    deleteItem: db.prepare(`
      DELETE FROM checklist_items WHERE id = ? AND outing_id = ?
    `),
    deleteOuting: db.prepare(`
      DELETE FROM outings WHERE id = ?
    `),
    getWeather: db.prepare(`
      SELECT payload, fetched_at FROM weather_cache WHERE outing_id = ?
    `),
    putWeather: db.prepare(`
      INSERT INTO weather_cache (outing_id, payload, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(outing_id) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
    `),
  };

  function mapParticipant(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      avatarKey: row.avatar_key,
      joinedAt: row.joined_at,
    };
  }

  function mapOuting(row) {
    if (!row) return null;
    return {
      id: row.id,
      inviteCode: row.invite_code,
      title: row.title,
      placeId: row.place_id,
      placeName: row.place_name,
      latitude: row.latitude,
      longitude: row.longitude,
      startsAt: row.starts_at,
      activityType: row.activity_type,
      expectedPeople: Number(row.expected_people ?? 2),
      createdAt: row.created_at,
    };
  }

  function addEvent(
    outingId,
    participantId,
    eventType,
    itemLabel = null,
  ) {
    statements.insertEvent.run(
      createOpaqueId("evt"),
      outingId,
      participantId,
      eventType,
      itemLabel,
      new Date().toISOString(),
    );
  }

  function authorize(outingId, token, anonymousUserKey = "") {
    if (token) {
      const participant = statements.getParticipantByToken.get(
        tokenHash(token),
      );
      if (participant?.outing_id === outingId) {
        if (anonymousUserKey) {
          const anonymousHash = tokenHash(anonymousUserKey);
          statements.linkAnonymousUser.run(
            anonymousHash,
            participant.id,
            outingId,
            anonymousHash,
          );
        }
        return mapParticipant(participant);
      }
    }
    if (!anonymousUserKey) return null;
    return mapParticipant(
      statements.getParticipantByAnonymousUser.get(
        tokenHash(anonymousUserKey),
        outingId,
      ),
    );
  }

  function listMySessions(anonymousUserKey) {
    if (!anonymousUserKey) return [];
    return statements.getSessionsByAnonymousUser
      .all(tokenHash(anonymousUserKey))
      .map((row) => ({
        participantId: row.participant_id,
        token: "",
        outingId: row.outing_id,
        title: row.title,
        placeName: row.place_name,
        startsAt: row.starts_at,
        activityType: row.activity_type,
      }));
  }

  function createOuting({
    title,
    place,
    startsAt,
    activityType,
    expectedPeople,
    creatorName,
    items,
    anonymousUserKey = "",
  }) {
    const outingId = createOpaqueId("out");
    const participantId = createOpaqueId("pt");
    const token = createToken();
    const inviteCode = createInviteCode();
    const now = new Date().toISOString();

    db.exec("BEGIN IMMEDIATE");
    try {
      statements.insertOuting.run(
        outingId,
        inviteCode,
        title,
        place.id,
        place.name,
        place.latitude,
        place.longitude,
        startsAt,
        activityType,
        normalizeExpectedPeople(expectedPeople),
        now,
      );
      statements.insertParticipant.run(
        participantId,
        outingId,
        creatorName,
        "me",
        tokenHash(token),
        anonymousUserKey ? tokenHash(anonymousUserKey) : null,
        now,
      );
      items.forEach((item, index) => {
        statements.insertItem.run(
          createOpaqueId("item"),
          outingId,
          item.key ?? createOpaqueId("custom"),
          item.label,
          item.visual,
          item.key === "water" || item.key === "snack" ? participantId : null,
          index,
        );
      });
      addEvent(outingId, participantId, "created");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      outingId,
      inviteCode,
      session: { participantId, token },
    };
  }

  function joinOuting({
    outingId,
    inviteCode,
    name,
    anonymousUserKey = "",
  }) {
    const outing = statements.getOuting.get(outingId);
    if (!outing || outing.invite_code !== inviteCode) return null;

    const anonymousHash = anonymousUserKey
      ? tokenHash(anonymousUserKey)
      : null;
    if (anonymousHash) {
      const existing = statements.getParticipantByAnonymousUser.get(
        anonymousHash,
        outingId,
      );
      if (existing) {
        return { participantId: existing.id, token: "" };
      }
    }

    const count = Number(statements.participantCount.get(outingId).count);
    const participantId = createOpaqueId("pt");
    const token = createToken();
    const now = new Date().toISOString();
    const avatarKey = AVATAR_KEYS[count % AVATAR_KEYS.length];

    statements.insertParticipant.run(
      participantId,
      outingId,
      name,
      avatarKey,
      tokenHash(token),
      anonymousHash,
      now,
    );
    addEvent(outingId, participantId, "joined");

    return { participantId, token };
  }

  function getOutingBundle(
    outingId,
    { token, inviteCode, anonymousUserKey } = {},
  ) {
    const outingRow = statements.getOuting.get(outingId);
    if (!outingRow) return { status: "not_found" };

    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer && outingRow.invite_code !== inviteCode) {
      return { status: "forbidden" };
    }

    const participants = statements
      .getParticipants
      .all(outingId)
      .map(mapParticipant);
    const participantById = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    const items = statements.getItems.all(outingId).map((row) => ({
      id: row.id,
      key: row.item_key,
      label: row.label,
      visual: row.image.includes(":") ? row.image : `asset:${row.image}`,
      owner: row.owner_id ? (participantById.get(row.owner_id) ?? null) : null,
      done: row.done === 1,
      sortOrder: row.sort_order,
      ...getSuggestedQuantity(
        row.item_key,
        Number(outingRow.expected_people ?? 2),
      ),
    }));
    const reactionRows = statements.getReactions.all(outingId);
    const reactionMap = new Map();
    for (const row of reactionRows) {
      const current = reactionMap.get(row.event_id) ?? {
        heart: 0,
        cheer: 0,
        viewerReaction: null,
      };
      if (row.reaction_type === "heart") current.heart += 1;
      if (row.reaction_type === "cheer") current.cheer += 1;
      if (viewer?.id === row.participant_id) {
        current.viewerReaction = row.reaction_type;
      }
      reactionMap.set(row.event_id, current);
    }
    const events = statements.getEvents.all(outingId).map((row) => {
      const reactions = reactionMap.get(row.id) ?? {
        heart: 0,
        cheer: 0,
        viewerReaction: null,
      };
      return {
        id: row.id,
        type: row.event_type,
        itemLabel: row.item_label,
        createdAt: row.created_at,
        participant: row.participant_id
          ? (participantById.get(row.participant_id) ?? null)
          : null,
        reactions: {
          heart: reactions.heart,
          cheer: reactions.cheer,
        },
        viewerReaction: reactions.viewerReaction,
      };
    });

    return {
      status: "ok",
      outing: mapOuting(outingRow),
      participants,
      items,
      events,
      viewer,
      canDelete: Boolean(viewer && participants[0]?.id === viewer.id),
    };
  }

  function updateItem({
    outingId,
    itemId,
    token,
    anonymousUserKey,
    done,
    ownerId,
  }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    const item = statements.getItem.get(itemId, outingId);
    if (!item) return { status: "not_found" };

    if (typeof ownerId !== "undefined") {
      if (
        ownerId !== null &&
        !statements.getParticipant.get(ownerId, outingId)
      ) {
        return { status: "invalid_owner" };
      }
      statements.updateOwner.run(ownerId, itemId, outingId);
      if (ownerId) {
        addEvent(outingId, ownerId, "claimed", item.label);
      } else {
        addEvent(outingId, viewer.id, "unassigned", item.label);
      }
    }
    if (typeof done === "boolean") {
      statements.updateDone.run(done ? 1 : 0, itemId, outingId);
      addEvent(
        outingId,
        viewer.id,
        done ? "completed" : "reopened",
        item.label,
      );
    }
    return { status: "ok" };
  }

  function completeMyItems({ outingId, token, anonymousUserKey }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    const result = statements.completeMine.run(outingId, viewer.id);
    if (Number(result.changes) > 0) {
      addEvent(outingId, viewer.id, "completed_mine");
    }
    return { status: "ok", completed: Number(result.changes) };
  }

  function addItem({ outingId, token, anonymousUserKey, item }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    if (Number(statements.itemCount.get(outingId).count) >= MAX_ITEMS) {
      return { status: "max_items" };
    }
    if (
      (item.key && statements.getItemByKey.get(item.key, outingId)) ||
      statements.getItemByLabel.get(item.label, outingId)
    ) {
      return { status: "duplicate" };
    }

    const sortOrder = Number(
      statements.nextSortOrder.get(outingId).next_order,
    );
    const itemId = createOpaqueId("item");
    statements.insertItem.run(
      itemId,
      outingId,
      item.key ?? createOpaqueId("custom"),
      item.label,
      item.visual,
      null,
      sortOrder,
    );
    addEvent(outingId, viewer.id, "item_added", item.label);
    return { status: "ok", itemId };
  }

  function deleteItem({ outingId, itemId, token, anonymousUserKey }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    const item = statements.getItem.get(itemId, outingId);
    if (!item) return { status: "not_found" };
    if (Number(statements.itemCount.get(outingId).count) <= 1) {
      return { status: "last_item" };
    }
    const result = statements.deleteItem.run(itemId, outingId);
    if (Number(result.changes) > 0) {
      addEvent(outingId, viewer.id, "item_deleted", item.label);
    }
    return Number(result.changes) > 0
      ? { status: "ok" }
      : { status: "not_found" };
  }

  function deleteOuting({ outingId, token, anonymousUserKey }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    const creator = statements.getParticipants.get(outingId);
    if (!creator || creator.id !== viewer.id) {
      return { status: "not_creator" };
    }
    const result = statements.deleteOuting.run(outingId);
    return Number(result.changes) > 0
      ? { status: "ok" }
      : { status: "not_found" };
  }

  function randomizeUnassigned({ outingId, token, anonymousUserKey }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    const participants = statements
      .getParticipants
      .all(outingId)
      .map(mapParticipant);
    const unassigned = statements.getUnassignedItems.all(outingId);
    if (participants.length < 2) return { status: "need_participants" };
    if (unassigned.length === 0) return { status: "nothing_to_assign" };

    const counts = new Map(
      statements.getOwnerCounts
        .all(outingId)
        .map((row) => [row.owner_id, Number(row.count)]),
    );
    const shuffled = [...unassigned];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [shuffled[index], shuffled[target]] = [
        shuffled[target],
        shuffled[index],
      ];
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of shuffled) {
        const lowestCount = Math.min(
          ...participants.map(
            (participant) => counts.get(participant.id) ?? 0,
          ),
        );
        const candidates = participants.filter(
          (participant) =>
            (counts.get(participant.id) ?? 0) === lowestCount,
        );
        const owner = candidates[randomInt(candidates.length)];
        statements.updateOwner.run(owner.id, item.id, outingId);
        counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
      }
      addEvent(
        outingId,
        viewer.id,
        "randomized",
        String(shuffled.length),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { status: "ok", assigned: shuffled.length };
  }

  function toggleEventReaction({
    outingId,
    eventId,
    token,
    anonymousUserKey,
    reactionType,
  }) {
    const viewer = authorize(outingId, token, anonymousUserKey);
    if (!viewer) return { status: "forbidden" };
    if (!statements.getEvent.get(eventId, outingId)) {
      return { status: "not_found" };
    }
    if (!["heart", "cheer"].includes(reactionType)) {
      return { status: "invalid_reaction" };
    }
    const existing = statements.getReaction.get(eventId, viewer.id);
    if (existing?.reaction_type === reactionType) {
      statements.deleteReaction.run(eventId, viewer.id);
      return { status: "ok", reaction: null };
    }
    statements.upsertReaction.run(
      eventId,
      viewer.id,
      reactionType,
      new Date().toISOString(),
    );
    return { status: "ok", reaction: reactionType };
  }

  function getWeatherCache(outingId) {
    const row = statements.getWeather.get(outingId);
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at };
    } catch {
      return null;
    }
  }

  function putWeatherCache(outingId, payload) {
    statements.putWeather.run(
      outingId,
      JSON.stringify(payload),
      Date.now(),
    );
  }

  return {
    addItem,
    authorize,
    close: () => db.close(),
    completeMyItems,
    createOuting,
    deleteItem,
    deleteOuting,
    getOutingBundle,
    getWeatherCache,
    joinOuting,
    listMySessions,
    putWeatherCache,
    randomizeUnassigned,
    toggleEventReaction,
    updateItem,
  };
}
