// Node(SQLite)와 Worker(D1)가 함께 쓰는 SQL이에요. 파라미터 순서도 같아요.

import { MAX_ITEMS } from "./item-options.mjs";
import { MAX_EVENTS, MAX_MY_OUTINGS, MAX_PARTICIPANTS } from "./outing-rules.mjs";

const RECENT_EVENT_IDS = `
  SELECT id FROM activity_events
  WHERE outing_id = ?
  ORDER BY created_at DESC, rowid DESC
  LIMIT ${MAX_EVENTS}
`;

const PARTICIPANT_COLUMNS =
  "id, outing_id, name, avatar_key, joined_at, anonymous_user_hash";

export function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

export const SQL = {
  // 권한 확인 + ETag 계산에 필요한 최소 정보(모임 행, 만든 사람, 날씨 캐시)
  // params: [outingId]
  outingAccess: `
    SELECT
      outings.*,
      (
        SELECT creator.id FROM participants AS creator
        WHERE creator.outing_id = outings.id
        ORDER BY creator.joined_at ASC, creator.rowid ASC
        LIMIT 1
      ) AS creator_id,
      weather_cache.payload AS weather_payload,
      weather_cache.fetched_at AS weather_fetched_at
    FROM outings
    LEFT JOIN weather_cache ON weather_cache.outing_id = outings.id
    WHERE outings.id = ?
  `,
  // params: [tokenHash, outingId]
  participantByToken: `
    SELECT ${PARTICIPANT_COLUMNS} FROM participants
    WHERE token_hash = ? AND outing_id = ?
  `,
  // params: [anonymousHash, outingId]
  participantByAnonymous: `
    SELECT ${PARTICIPANT_COLUMNS} FROM participants
    WHERE anonymous_user_hash = ? AND outing_id = ?
  `,
  // params: [anonymousHash, participantId, outingId, anonymousHash]
  linkAnonymousUser: `
    UPDATE participants
    SET anonymous_user_hash = ?
    WHERE id = ?
      AND anonymous_user_hash IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM participants AS existing
        WHERE existing.outing_id = ?
          AND existing.anonymous_user_hash = ?
      )
  `,
  // params: [outingId]
  participants: `
    SELECT id, name, avatar_key, joined_at
    FROM participants
    WHERE outing_id = ?
    ORDER BY joined_at ASC, rowid ASC
  `,
  // params: [outingId]
  participantCount: `
    SELECT COUNT(*) AS count FROM participants WHERE outing_id = ?
  `,
  // params: [participantId, outingId]
  participantName: `
    SELECT name FROM participants WHERE id = ? AND outing_id = ?
  `,
  // params: [outingId]
  items: `
    SELECT id, item_key, label, image, owner_id, done, sort_order
    FROM checklist_items
    WHERE outing_id = ?
    ORDER BY sort_order ASC
  `,
  // params: [outingId]
  recentEvents: `
    SELECT id, participant_id, event_type, item_label, created_at
    FROM activity_events
    WHERE outing_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ${MAX_EVENTS}
  `,
  // 반환되는 최근 이벤트에 대해서만 응원 수를 집계해요.
  // params: [viewerId | null, outingId]
  recentEventReactions: `
    SELECT
      event_id,
      SUM(CASE WHEN reaction_type = 'heart' THEN 1 ELSE 0 END) AS heart,
      SUM(CASE WHEN reaction_type = 'cheer' THEN 1 ELSE 0 END) AS cheer,
      MAX(CASE WHEN participant_id = ? THEN reaction_type END)
        AS viewer_reaction
    FROM event_reactions
    WHERE event_id IN (${RECENT_EVENT_IDS})
    GROUP BY event_id
  `,
  // params: [id, inviteCode, title, placeId, placeName, latitude, longitude,
  //          startsAt, activityType, expectedPeople, createdAt]
  insertOuting: `
    INSERT INTO outings (
      id, invite_code, title, place_id, place_name,
      latitude, longitude, starts_at, activity_type,
      expected_people, created_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `,
  // params: [id, outingId, name, avatarKey, tokenHash, anonymousHash, joinedAt]
  insertParticipant: `
    INSERT INTO participants (
      id, outing_id, name, avatar_key, token_hash,
      anonymous_user_hash, joined_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  // 인원 제한을 같은 문장에서 확인해요.
  // params: [id, outingId, name, avatarKey, tokenHash, anonymousHash,
  //          joinedAt, outingId]
  insertParticipantIfRoom: `
    INSERT INTO participants (
      id, outing_id, name, avatar_key, token_hash,
      anonymous_user_hash, joined_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM participants WHERE outing_id = ?
    ) < ${MAX_PARTICIPANTS}
  `,
  // params: [tokenHash, participantId]
  rotateParticipantToken: `
    UPDATE participants SET token_hash = ? WHERE id = ?
  `,
  // params: [id, outingId, itemKey, label, image, ownerId, sortOrder]
  insertItem: `
    INSERT INTO checklist_items (
      id, outing_id, item_key, label, image, owner_id, done, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `,
  // 중복·최대 개수 확인과 추가를 한 문장으로 처리해요.
  // params: [id, outingId, itemKey, label, image, outingId,
  //          outingId, itemKeyOrEmpty, label, outingId]
  insertItemIfAllowed: `
    INSERT INTO checklist_items (
      id, outing_id, item_key, label, image, owner_id, done, sort_order
    )
    SELECT ?, ?, ?, ?, ?, NULL, 0, (
      SELECT COALESCE(MAX(sort_order), -1) + 1
      FROM checklist_items WHERE outing_id = ?
    )
    WHERE NOT EXISTS (
      SELECT 1 FROM checklist_items
      WHERE outing_id = ? AND (item_key = ? OR label = ?)
    )
    AND (
      SELECT COUNT(*) FROM checklist_items WHERE outing_id = ?
    ) < ${MAX_ITEMS}
  `,
  // params: [outingId]
  itemCount: `
    SELECT COUNT(*) AS count FROM checklist_items WHERE outing_id = ?
  `,
  // params: [itemId, outingId]
  item: `
    SELECT id, item_key, label, owner_id, done
    FROM checklist_items WHERE id = ? AND outing_id = ?
  `,
  // 읽은 담당자·완료 상태가 그대로일 때만 바꿔요(compare-and-swap).
  // params: [ownerId, done, itemId, outingId, observedOwnerId, observedDone]
  updateItemIfUnchanged: `
    UPDATE checklist_items SET owner_id = ?, done = ?
    WHERE id = ? AND outing_id = ? AND owner_id IS ? AND done = ?
  `,
  // 마지막 준비물은 지우지 않고, 읽은 담당자가 그대로일 때만 지워요.
  // params: [itemId, outingId, observedOwnerId, outingId]
  deleteItemIfAllowed: `
    DELETE FROM checklist_items
    WHERE id = ? AND outing_id = ? AND owner_id IS ?
      AND (
        SELECT COUNT(*) FROM checklist_items WHERE outing_id = ?
      ) > 1
  `,
  // params: [outingId, participantId]
  completeMine: `
    UPDATE checklist_items SET done = 1
    WHERE outing_id = ? AND owner_id = ? AND done = 0
  `,
  // params: [outingId]
  unassignedItems: `
    SELECT id FROM checklist_items
    WHERE outing_id = ? AND owner_id IS NULL
    ORDER BY sort_order ASC
  `,
  // params: [outingId]
  ownerCounts: `
    SELECT owner_id, COUNT(*) AS count FROM checklist_items
    WHERE outing_id = ? AND owner_id IS NOT NULL
    GROUP BY owner_id
  `,
  // params: [ownerId, itemId, outingId]
  assignIfUnowned: `
    UPDATE checklist_items SET owner_id = ?, done = 0
    WHERE id = ? AND outing_id = ? AND owner_id IS NULL
  `,
  // params: [itemId, outingId]
  itemOwner: `
    SELECT owner_id FROM checklist_items WHERE id = ? AND outing_id = ?
  `,
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt]
  insertEvent: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `,
  // 새로 만든 행(참여자·준비물)이 실제로 들어갔을 때만 이벤트를 남겨요.
  // D1 batch 한 번으로 조건부 쓰기를 원자적으로 처리하려고 써요.
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          newParticipantId]
  insertEventIfParticipant: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM participants WHERE id = ?)
  `,
  // params: [outingId, newParticipantId]
  bumpRevisionIfParticipant: `
    UPDATE outings SET revision = revision + 1
    WHERE id = ? AND EXISTS (SELECT 1 FROM participants WHERE id = ?)
  `,
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          newItemId]
  insertEventIfItem: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM checklist_items WHERE id = ?)
  `,
  // params: [outingId, newItemId]
  bumpRevisionIfItem: `
    UPDATE outings SET revision = revision + 1
    WHERE id = ? AND EXISTS (SELECT 1 FROM checklist_items WHERE id = ?)
  `,
  // 아래 이벤트 문장들은 D1 batch에서 조건부 쓰기 "앞"에 두고, 그 쓰기와
  // 같은 조건을 확인해요. batch는 한 트랜잭션이라 조건이 맞으면 뒤따르는
  // 쓰기도 반드시 반영돼요(changes()에 기대지 않아요).
  // updateItemIfUnchanged와 같은 조건이에요.
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          itemId, outingId, observedOwnerId, observedDone]
  insertEventIfItemUnchanged: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM checklist_items
      WHERE id = ? AND outing_id = ? AND owner_id IS ? AND done = ?
    )
  `,
  // deleteItemIfAllowed와 같은 조건이에요.
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          itemId, outingId, observedOwnerId, outingId]
  insertEventIfItemDeletable: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM checklist_items
      WHERE id = ? AND outing_id = ? AND owner_id IS ?
    )
    AND (
      SELECT COUNT(*) FROM checklist_items WHERE outing_id = ?
    ) > 1
  `,
  // completeMine과 같은 조건이에요.
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          outingId, participantId]
  insertEventIfOpenItems: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM checklist_items
      WHERE outing_id = ? AND owner_id = ? AND done = 0
    )
  `,
  // assignIfUnowned와 같은 조건이에요.
  // params: [id, outingId, participantId, eventType, itemLabel, createdAt,
  //          itemId, outingId]
  insertEventIfUnowned: `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM checklist_items
      WHERE id = ? AND outing_id = ? AND owner_id IS NULL
    )
  `,
  // params: [outingId]
  outingInvite: `SELECT id, invite_code FROM outings WHERE id = ?`,
  // params: [outingId]
  bumpRevision: `
    UPDATE outings SET revision = revision + 1 WHERE id = ?
  `,
  // params: [inviteCode, outingId]
  resetInviteCode: `
    UPDATE outings SET invite_code = ?, revision = revision + 1 WHERE id = ?
  `,
  // params: [eventId, outingId]
  event: `
    SELECT id FROM activity_events WHERE id = ? AND outing_id = ?
  `,
  // params: [eventId, participantId]
  reaction: `
    SELECT reaction_type FROM event_reactions
    WHERE event_id = ? AND participant_id = ?
  `,
  // params: [eventId, participantId, reactionType, createdAt]
  upsertReaction: `
    INSERT INTO event_reactions (
      event_id, participant_id, reaction_type, created_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, participant_id) DO UPDATE SET
      reaction_type = excluded.reaction_type,
      created_at = excluded.created_at
  `,
  // params: [eventId, participantId]
  deleteReaction: `
    DELETE FROM event_reactions WHERE event_id = ? AND participant_id = ?
  `,
  // params: [outingId]
  deleteOuting: `DELETE FROM outings WHERE id = ?`,
  // 예보를 받은 뒤 모임 날짜·장소가 바뀌었거나 모임이 지워졌으면 쓰지
  // 않아요(늦게 끝난 갱신이 새 예보를 덮거나 FK 오류가 나지 않게).
  // SELECT에 WHERE가 있어 upsert의 ON CONFLICT와 헷갈리지 않아요.
  // params: [outingId, payload, fetchedAt,
  //          outingId, startsAt, latitude, longitude]
  putWeather: `
    INSERT INTO weather_cache (outing_id, payload, fetched_at)
    SELECT ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM outings
      WHERE id = ? AND starts_at = ? AND latitude = ? AND longitude = ?
    )
    ON CONFLICT(outing_id) DO UPDATE SET
      payload = excluded.payload,
      fetched_at = excluded.fetched_at
  `,
  // params: [outingId]
  deleteWeather: `DELETE FROM weather_cache WHERE outing_id = ?`,
  // 다가오는 모임은 가까운 순, 지난 모임은 최근 순이에요.
  // params: [anonymousHash, todayKey, todayKey]
  mySessions: `
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
    ORDER BY
      CASE WHEN substr(outings.starts_at, 1, 10) >= ? THEN 0 ELSE 1 END ASC,
      CASE WHEN substr(outings.starts_at, 1, 10) >= ?
        THEN outings.starts_at END ASC,
      outings.starts_at DESC
    LIMIT ${MAX_MY_OUTINGS}
  `,
  // 하루 사용량을 원자적으로 올려요. 한도에 닿으면 행을 돌려주지 않아요.
  // params: [bucket, windowStart, limit]
  consumeRateLimit: `
    INSERT INTO rate_limits (bucket, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
    WHERE count < ?
    RETURNING count
  `,
  // params: [bucket, windowStart]
  releaseRateLimit: `
    UPDATE rate_limits SET count = count - 1
    WHERE bucket = ? AND window_start = ? AND count > 0
  `,
};

// 요약 API: 세션 수만큼 placeholder를 넣어 한 번에 읽어요.
export const SUMMARY_SQL = {
  tokenParticipants: (count) => `
    SELECT id, outing_id, token_hash, anonymous_user_hash FROM participants
    WHERE token_hash IN (${placeholders(count)})
  `,
  anonymousParticipants: (count) => `
    SELECT id, outing_id FROM participants
    WHERE anonymous_user_hash = ? AND outing_id IN (${placeholders(count)})
  `,
  outings: (count) => `
    SELECT
      outings.id, outings.title, outings.place_name, outings.starts_at,
      (
        SELECT creator.id FROM participants AS creator
        WHERE creator.outing_id = outings.id
        ORDER BY creator.joined_at ASC, creator.rowid ASC
        LIMIT 1
      ) AS creator_id
    FROM outings WHERE outings.id IN (${placeholders(count)})
  `,
  items: (count) => `
    SELECT outing_id, owner_id, done FROM checklist_items
    WHERE outing_id IN (${placeholders(count)})
  `,
};

// 무작위 배정(assignIfUnowned 여러 개) "앞"에 두는 이벤트예요. 아직 담당자가
// 없는 대상 준비물 수가 곧 배정될 개수라 item_label에 그 수를 남기고,
// 하나도 없으면 이벤트를 남기지 않아요.
// params: [id, outingId, participantId, outingId, ...itemIds, createdAt,
//          outingId, ...itemIds]
export function insertRandomizedEventSql(itemCount) {
  const ids = placeholders(itemCount);
  return `
    INSERT INTO activity_events (
      id, outing_id, participant_id, event_type, item_label, created_at
    )
    SELECT ?, ?, ?, 'randomized', (
      SELECT CAST(COUNT(*) AS TEXT) FROM checklist_items
      WHERE outing_id = ? AND owner_id IS NULL AND id IN (${ids})
    ), ?
    WHERE EXISTS (
      SELECT 1 FROM checklist_items
      WHERE outing_id = ? AND owner_id IS NULL AND id IN (${ids})
    )
  `;
}

// 예전 서버(최대 999명)가 저장한 50명 초과 예상 인원을 50명으로 맞춰요.
// migrations/0005_revisions_rate_limits.sql과 같은 내용이에요.
export const NORMALIZE_EXPECTED_PEOPLE_SQL = `
  UPDATE outings SET expected_people = 50 WHERE expected_people > 50;
`;

// 오래된 데이터 정리: 지운 모임에 딸린 행을 함께 지워요.
export const CLEANUP_SQL = {
  // starts_at은 'YYYY-MM-DDT..+09:00'으로 정규화돼 있어 날짜 키와
  // 문자열로 비교하면 정확하고 outings_starts_at_idx도 써요.
  // params: [cutoffDateKey]
  expiredOutingIds: `
    SELECT id FROM outings WHERE starts_at < ? LIMIT 40
  `,
  deleteForOutings: (count) => {
    const ids = placeholders(count);
    return [
      `DELETE FROM event_reactions WHERE event_id IN (
         SELECT id FROM activity_events WHERE outing_id IN (${ids})
       )`,
      `DELETE FROM activity_events WHERE outing_id IN (${ids})`,
      `DELETE FROM checklist_items WHERE outing_id IN (${ids})`,
      `DELETE FROM weather_cache WHERE outing_id IN (${ids})`,
      `DELETE FROM participants WHERE outing_id IN (${ids})`,
      `DELETE FROM outings WHERE id IN (${ids})`,
    ];
  },
  // Worker(D1) 전용 AI 캐시 테이블
  deleteAiForOutings: (count) => {
    const ids = placeholders(count);
    return [
      `DELETE FROM ai_briefings WHERE outing_id IN (${ids})`,
      `DELETE FROM summer_event_searches WHERE outing_id IN (${ids})`,
    ];
  },
  // params: [rateWindowBefore]
  deleteOldRateLimits: `DELETE FROM rate_limits WHERE window_start < ?`,
  // params: [crowdFetchedBefore]
  deleteOldCrowdCache: `DELETE FROM crowd_cache WHERE fetched_at < ?`,
  // params: [now]
  deleteExpiredAiBriefings: `DELETE FROM ai_briefings WHERE expires_at < ?`,
  // params: [now]
  deleteExpiredSummerEvents: `
    DELETE FROM summer_event_searches WHERE expires_at < ?
  `,
};

// 이전 형식(UTC 'Z' 등)으로 저장된 startsAt을 +09:00 형식으로 바꿔요.
export const NORMALIZE_STARTS_AT_SQL = `
  -- 시간대가 있는 값(UTC 'Z', 다른 오프셋)은 한국 시간으로 바꿔요.
  UPDATE outings
  SET starts_at = strftime('%Y-%m-%dT%H:%M:00+09:00', starts_at, '+9 hours')
  WHERE (starts_at LIKE '%Z' OR starts_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]')
    AND strftime('%Y-%m-%dT%H:%M:00+09:00', starts_at, '+9 hours') IS NOT NULL
    AND starts_at <> strftime('%Y-%m-%dT%H:%M:00+09:00', starts_at, '+9 hours');
  
  -- 시간대가 없는 값은 이미 한국 시간으로 읽으므로 시각은 그대로 두고 형식만 맞춰요.
  UPDATE outings
  SET starts_at = strftime('%Y-%m-%dT%H:%M:00+09:00', starts_at)
  WHERE NOT (starts_at LIKE '%Z' OR starts_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]')
    AND strftime('%Y-%m-%dT%H:%M:00+09:00', starts_at) IS NOT NULL;
`;
