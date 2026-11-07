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
import { getKoreaDateKey } from "./kst-date.mjs";
import {
  assembleOutingSummaries,
  buildOutingUpdate,
  canDeleteItem,
  diffOutingChanges,
  getCleanupCutoffs,
  mapMySessionRow,
  MAX_PARTICIPANTS,
  pickViewer,
  planItemUpdate,
  planRandomAssignments,
  resolveAvatarKey,
  shouldLinkAnonymousUser,
} from "./outing-rules.mjs";
import {
  CLEANUP_SQL,
  NORMALIZE_EXPECTED_PEOPLE_SQL,
  NORMALIZE_STARTS_AT_SQL,
  SQL,
  SUMMARY_SQL,
} from "./outing-sql.mjs";

const MAX_WRITE_ATTEMPTS = 3;

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

function changes(result) {
  return Number(result?.changes ?? 0);
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
      created_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    );

    CREATE INDEX IF NOT EXISTS rate_limits_window_idx
      ON rate_limits(window_start);
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
  if (!outingColumns.some((column) => column.name === "revision")) {
    db.exec(
      "ALTER TABLE outings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
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
      WHERE anonymous_user_hash IS NOT NULL;

    CREATE INDEX IF NOT EXISTS participants_anonymous_user_idx
      ON participants(anonymous_user_hash);

    CREATE INDEX IF NOT EXISTS outings_starts_at_idx
      ON outings(starts_at);
  `);
  db.exec(NORMALIZE_STARTS_AT_SQL);
  db.exec(NORMALIZE_EXPECTED_PEOPLE_SQL);

  const statementCache = new Map();
  function stmt(sql) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  }

  function transaction(run) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function addEvent(outingId, participantId, eventType, itemLabel = null) {
    stmt(SQL.insertEvent).run(
      createOpaqueId("evt"),
      outingId,
      participantId,
      eventType,
      itemLabel,
      new Date().toISOString(),
    );
  }

  function bumpRevision(outingId) {
    stmt(SQL.bumpRevision).run(outingId);
  }

  function participantName(participantId, outingId) {
    if (!participantId) return "";
    return stmt(SQL.participantName).get(participantId, outingId)?.name ?? "";
  }

  /**
   * 모임 행·만든 사람·날씨 캐시를 읽고 참여자 권한을 확인해요.
   * status: "ok" | "not_found" | "forbidden"
   */
  function resolveAccess(
    outingId,
    { token = "", anonymousUserKey = "", inviteCode = "" } = {},
  ) {
    const outingRow = stmt(SQL.outingAccess).get(outingId);
    if (!outingRow) return { status: "not_found" };

    const anonymousHash = anonymousUserKey
      ? tokenHash(anonymousUserKey)
      : null;
    const tokenRow = token
      ? (stmt(SQL.participantByToken).get(tokenHash(token), outingId) ?? null)
      : null;
    const anonymousRow = anonymousHash
      ? (stmt(SQL.participantByAnonymous).get(anonymousHash, outingId) ??
        null)
      : null;
    if (shouldLinkAnonymousUser(tokenRow, anonymousRow, anonymousHash)) {
      stmt(SQL.linkAnonymousUser).run(
        anonymousHash,
        tokenRow.id,
        outingId,
        anonymousHash,
      );
    }
    const viewer = pickViewer(tokenRow, anonymousRow);
    if (!viewer && (!inviteCode || outingRow.invite_code !== inviteCode)) {
      return { status: "forbidden", outingRow };
    }
    return {
      status: "ok",
      outingRow,
      viewer,
      isCreator: Boolean(viewer && viewer.id === outingRow.creator_id),
    };
  }

  function getBundleRows(outingId, viewerId) {
    return {
      participantRows: stmt(SQL.participants).all(outingId),
      itemRows: stmt(SQL.items).all(outingId),
      eventRows: stmt(SQL.recentEvents).all(outingId),
      reactionRows: stmt(SQL.recentEventReactions).all(
        viewerId ?? null,
        outingId,
      ),
    };
  }

  function createOuting({ values, items, anonymousUserKey = "", avatarKey }) {
    const outingId = createOpaqueId("out");
    const participantId = createOpaqueId("pt");
    const token = createToken();
    const now = new Date().toISOString();

    transaction(() => {
      stmt(SQL.insertOuting).run(
        outingId,
        createInviteCode(),
        values.title,
        values.place.id,
        values.place.name,
        values.place.latitude,
        values.place.longitude,
        values.startsAt,
        values.activityType,
        values.expectedPeople,
        now,
      );
      stmt(SQL.insertParticipant).run(
        participantId,
        outingId,
        values.creatorName,
        resolveAvatarKey(avatarKey, 0),
        tokenHash(token),
        anonymousUserKey ? tokenHash(anonymousUserKey) : null,
        now,
      );
      items.forEach((item, index) => {
        stmt(SQL.insertItem).run(
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
    });

    return { outingId, session: { participantId, token } };
  }

  function claimForJoin(outingId, participantId, claimItemId) {
    if (!claimItemId) return { claimResult: "none", changed: false };
    const item = stmt(SQL.item).get(claimItemId, outingId);
    if (!item) return { claimResult: "none", changed: false };
    if (item.owner_id == null) {
      const result = stmt(SQL.assignIfUnowned).run(
        participantId,
        claimItemId,
        outingId,
      );
      if (changes(result) > 0) {
        addEvent(outingId, participantId, "claimed", item.label);
        return { claimResult: "claimed", changed: true };
      }
    }
    const owner = stmt(SQL.itemOwner).get(claimItemId, outingId);
    if (!owner) return { claimResult: "none", changed: false };
    return {
      claimResult: owner.owner_id === participantId ? "claimed" : "taken",
      changed: false,
    };
  }

  function joinOuting({
    outingId,
    inviteCode,
    name,
    anonymousUserKey = "",
    avatarKey,
    claimItemId,
  }) {
    const outing = stmt(SQL.outingInvite).get(outingId);
    if (!outing || outing.invite_code !== inviteCode) {
      return { error: "invalid_invite" };
    }
    const anonymousHash = anonymousUserKey
      ? tokenHash(anonymousUserKey)
      : null;

    return transaction(() => {
      const token = createToken();
      const existing = anonymousHash
        ? stmt(SQL.participantByAnonymous).get(anonymousHash, outingId)
        : null;
      let participantId;
      let changed = false;
      let created = false;
      if (existing) {
        // 같은 토스 사용자가 다시 참여하면 기존 참여자에 새 토큰을 줘요.
        participantId = existing.id;
        stmt(SQL.rotateParticipantToken).run(tokenHash(token), participantId);
      } else {
        const count = Number(stmt(SQL.participantCount).get(outingId).count);
        if (count >= MAX_PARTICIPANTS) return { error: "outing_full" };
        participantId = createOpaqueId("pt");
        const inserted = stmt(SQL.insertParticipantIfRoom).run(
          participantId,
          outingId,
          name,
          resolveAvatarKey(avatarKey, count),
          tokenHash(token),
          anonymousHash,
          new Date().toISOString(),
          outingId,
        );
        if (changes(inserted) === 0) return { error: "outing_full" };
        addEvent(outingId, participantId, "joined");
        changed = true;
        created = true;
      }
      const claim = claimForJoin(outingId, participantId, claimItemId);
      if (changed || claim.changed) bumpRevision(outingId);
      return {
        status: "ok",
        created,
        session: { participantId, token },
        claimResult: claim.claimResult,
      };
    });
  }

  function updateOuting({ outingRow, viewer, values }) {
    const diff = diffOutingChanges(outingRow, values);
    if (!diff.changed) return { status: "ok", changed: false };
    const update = buildOutingUpdate(outingRow.id, diff.changes);
    transaction(() => {
      stmt(update.sql).run(...update.params);
      addEvent(outingRow.id, viewer.id, "updated");
      if (diff.invalidatesWeather) stmt(SQL.deleteWeather).run(outingRow.id);
    });
    return {
      status: "ok",
      changed: true,
      invalidatesWeather: diff.invalidatesWeather,
    };
  }

  function resetInviteCode(outingId) {
    const inviteCode = createInviteCode();
    stmt(SQL.resetInviteCode).run(inviteCode, outingId);
    return { status: "ok", inviteCode };
  }

  function updateItem({ outingId, itemId, viewer, isCreator, ownerId, done }) {
    const participantIds = new Set(
      stmt(SQL.participants)
        .all(outingId)
        .map((row) => row.id),
    );
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const item = stmt(SQL.item).get(itemId, outingId);
      if (!item) return { error: "item_update_failed" };
      const plan = planItemUpdate({
        item,
        viewerId: viewer.id,
        isCreator,
        requestedOwnerId: ownerId,
        requestedDone: done,
        participantIds,
      });
      if (plan.error === "already_claimed") {
        return {
          error: plan.error,
          ownerName: participantName(plan.ownerId, outingId),
        };
      }
      if (plan.error) return { error: plan.error };
      if (plan.noop) return { status: "ok" };

      const applied = transaction(() => {
        const result = stmt(SQL.updateItemIfUnchanged).run(
          plan.ownerId,
          plan.done ? 1 : 0,
          itemId,
          outingId,
          item.owner_id ?? null,
          Number(item.done),
        );
        if (changes(result) === 0) return false;
        for (const event of plan.events) {
          addEvent(outingId, event.participantId, event.type, item.label);
        }
        bumpRevision(outingId);
        return true;
      });
      if (applied) return { status: "ok" };
    }
    const latest = stmt(SQL.item).get(itemId, outingId);
    if (!latest) return { error: "item_update_failed" };
    return {
      error: "already_claimed",
      ownerName: participantName(latest.owner_id, outingId),
    };
  }

  function addItem({ outingId, viewer, item }) {
    const itemId = createOpaqueId("item");
    return transaction(() => {
      const result = stmt(SQL.insertItemIfAllowed).run(
        itemId,
        outingId,
        item.key ?? createOpaqueId("custom"),
        item.label,
        item.visual,
        outingId,
        outingId,
        item.key ?? "",
        item.label,
        outingId,
      );
      if (changes(result) === 0) {
        const count = Number(stmt(SQL.itemCount).get(outingId).count);
        return { error: count >= MAX_ITEMS ? "max_items" : "duplicate_item" };
      }
      addEvent(outingId, viewer.id, "item_added", item.label);
      bumpRevision(outingId);
      return { status: "ok", itemId };
    });
  }

  function deleteItem({ outingId, itemId, viewer, isCreator }) {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const item = stmt(SQL.item).get(itemId, outingId);
      if (!item) return { error: "item_not_found" };
      if (!canDeleteItem({ item, viewerId: viewer.id, isCreator })) {
        return { error: "forbidden_delete" };
      }
      const outcome = transaction(() => {
        const result = stmt(SQL.deleteItemIfAllowed).run(
          itemId,
          outingId,
          item.owner_id ?? null,
          outingId,
        );
        if (changes(result) === 0) {
          const count = Number(stmt(SQL.itemCount).get(outingId).count);
          return count <= 1 ? "last_item" : "retry";
        }
        addEvent(outingId, viewer.id, "item_deleted", item.label);
        bumpRevision(outingId);
        return "ok";
      });
      if (outcome === "ok") return { status: "ok" };
      if (outcome === "last_item") return { error: "last_item" };
    }
    return { error: "item_not_found" };
  }

  function completeMyItems({ outingId, viewer }) {
    return transaction(() => {
      const completed = changes(
        stmt(SQL.completeMine).run(outingId, viewer.id),
      );
      if (completed > 0) {
        addEvent(outingId, viewer.id, "completed_mine");
        bumpRevision(outingId);
      }
      return { status: "ok", completed };
    });
  }

  function randomizeUnassigned({ outingId, viewer }) {
    const participantIds = stmt(SQL.participants)
      .all(outingId)
      .map((row) => row.id);
    const unassigned = stmt(SQL.unassignedItems).all(outingId);
    if (participantIds.length < 2) return { error: "need_participants" };
    if (unassigned.length === 0) return { error: "nothing_to_assign" };

    const assignments = planRandomAssignments({
      participantIds,
      unassignedItemIds: unassigned.map((row) => row.id),
      ownerCounts: stmt(SQL.ownerCounts)
        .all(outingId)
        .map((row) => [row.owner_id, Number(row.count)]),
      randomInt,
    });
    return transaction(() => {
      let assigned = 0;
      for (const { itemId, ownerId } of assignments) {
        assigned += changes(
          stmt(SQL.assignIfUnowned).run(ownerId, itemId, outingId),
        );
      }
      if (assigned === 0) return { error: "nothing_to_assign" };
      addEvent(outingId, viewer.id, "randomized", String(assigned));
      bumpRevision(outingId);
      return { status: "ok", assigned };
    });
  }

  function toggleEventReaction({ outingId, eventId, viewer, reactionType }) {
    if (!["heart", "cheer"].includes(reactionType)) {
      return { error: "invalid_reaction" };
    }
    if (!stmt(SQL.event).get(eventId, outingId)) {
      return { error: "event_not_found" };
    }
    return transaction(() => {
      const existing = stmt(SQL.reaction).get(eventId, viewer.id);
      let reaction = reactionType;
      if (existing?.reaction_type === reactionType) {
        stmt(SQL.deleteReaction).run(eventId, viewer.id);
        reaction = null;
      } else {
        stmt(SQL.upsertReaction).run(
          eventId,
          viewer.id,
          reactionType,
          new Date().toISOString(),
        );
      }
      bumpRevision(outingId);
      return { status: "ok", reaction };
    });
  }

  function deleteOuting(outingId) {
    return changes(stmt(SQL.deleteOuting).run(outingId)) > 0
      ? { status: "ok" }
      : { error: "not_found" };
  }

  function listMySessions(anonymousUserKey, now = Date.now()) {
    if (!anonymousUserKey) return [];
    const today = getKoreaDateKey(now);
    return stmt(SQL.mySessions)
      .all(tokenHash(anonymousUserKey), today, today)
      .map((row) => mapMySessionRow(row, now));
  }

  /** 결과: { summaries, missing } (missing은 모임 행이 없는 outingId 목록) */
  function getOutingSummaries(sessions, anonymousUserKey = "", now = Date.now()) {
    if (sessions.length === 0) return { summaries: [], missing: [] };
    const outingIds = sessions.map((session) => session.outingId);
    const tokenHashes = sessions.map((session) =>
      session.token ? tokenHash(session.token) : null,
    );
    const presentHashes = tokenHashes.filter(Boolean);
    const anonymousHash = anonymousUserKey
      ? tokenHash(anonymousUserKey)
      : null;

    const { summaries, links, missing } = assembleOutingSummaries({
      sessions,
      tokenHashes,
      anonymousHash,
      tokenRows:
        presentHashes.length > 0
          ? stmt(SUMMARY_SQL.tokenParticipants(presentHashes.length)).all(
              ...presentHashes,
            )
          : [],
      anonymousRows: anonymousHash
        ? stmt(SUMMARY_SQL.anonymousParticipants(outingIds.length)).all(
            anonymousHash,
            ...outingIds,
          )
        : [],
      outingRows: stmt(SUMMARY_SQL.outings(outingIds.length)).all(
        ...outingIds,
      ),
      itemRows: stmt(SUMMARY_SQL.items(outingIds.length)).all(...outingIds),
      now,
    });
    for (const link of links) {
      stmt(SQL.linkAnonymousUser).run(
        anonymousHash,
        link.participantId,
        link.outingId,
        anonymousHash,
      );
    }
    return { summaries, missing };
  }

  /**
   * 여러 사용량 버킷을 차례로 1씩 올려요. 하나라도 한도를 넘으면
   * 앞에서 올린 값을 되돌리고 그 버킷을 알려줘요.
   */
  function consumeRateLimits(entries, windowStart) {
    const consumed = [];
    for (const entry of entries) {
      const row = stmt(SQL.consumeRateLimit).get(
        entry.bucket,
        windowStart,
        entry.limit,
      );
      if (!row) {
        for (const previous of consumed) {
          stmt(SQL.releaseRateLimit).run(previous.bucket, windowStart);
        }
        return { limited: entry };
      }
      consumed.push(entry);
    }
    return { limited: null };
  }

  function getWeatherCache(outingId) {
    const row = stmt(
      "SELECT payload, fetched_at FROM weather_cache WHERE outing_id = ?",
    ).get(outingId);
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at };
    } catch {
      return null;
    }
  }

  /**
   * 예보를 받을 때 쓴 모임(id·startsAt·latitude·longitude)이 그대로일 때만
   * 캐시를 써요. 그사이 날짜·장소가 바뀌었거나 모임이 지워졌으면 건너뛰어요.
   */
  function putWeatherCache(outing, payload, fetchedAt = Date.now()) {
    const result = stmt(SQL.putWeather).run(
      outing.id,
      JSON.stringify(payload ?? null),
      fetchedAt,
      outing.id,
      outing.startsAt,
      outing.latitude,
      outing.longitude,
    );
    return { written: changes(result) > 0 };
  }

  /** 180일 지난 모임과 오래된 사용량 기록을 지워요. */
  function cleanup(now = Date.now()) {
    const cutoffs = getCleanupCutoffs(now);
    let deletedOutings = 0;
    for (let round = 0; round < 50; round += 1) {
      const ids = stmt(CLEANUP_SQL.expiredOutingIds)
        .all(cutoffs.outingDateKey)
        .map((row) => row.id);
      if (ids.length === 0) break;
      transaction(() => {
        for (const sql of CLEANUP_SQL.deleteForOutings(ids.length)) {
          stmt(sql).run(...ids);
        }
      });
      deletedOutings += ids.length;
    }
    stmt(CLEANUP_SQL.deleteOldRateLimits).run(cutoffs.rateWindowBefore);
    return { deletedOutings };
  }

  return {
    addItem,
    cleanup,
    close: () => db.close(),
    completeMyItems,
    consumeRateLimits,
    createOuting,
    deleteItem,
    deleteOuting,
    getBundleRows,
    getOutingSummaries,
    getWeatherCache,
    joinOuting,
    listMySessions,
    putWeatherCache,
    randomizeUnassigned,
    resetInviteCode,
    resolveAccess,
    toggleEventReaction,
    updateItem,
    updateOuting,
  };
}
