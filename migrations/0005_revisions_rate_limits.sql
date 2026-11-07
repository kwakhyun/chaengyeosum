-- 모임이 바뀔 때마다 올라가는 번호예요. GET /api/outings/:id 의 ETag에 써요.
ALTER TABLE outings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- 내 모임 목록(/api/me/outings) 조회용 인덱스예요.
CREATE INDEX IF NOT EXISTS participants_anonymous_user_idx
  ON participants(anonymous_user_hash);

-- 오래된 모임 정리(scheduled)용 인덱스예요.
CREATE INDEX IF NOT EXISTS outings_starts_at_idx
  ON outings(starts_at);

-- 사용자 키·IP·모임별, 그리고 서비스 전체 AI 호출(openai-global)의 하루 사용량이에요.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx
  ON rate_limits(window_start);

-- 이전 형식(UTC 'Z' 등)으로 저장된 시작 시각을 한국 시간 형식
-- (YYYY-MM-DDTHH:mm:00+09:00)으로 맞춰 날짜 비교·정렬이 정확하게 해요.
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

-- 예전 서버는 예상 인원을 999명까지 저장했어요. 지금은 1~50명만 다루므로
-- 50명을 넘는 값은 50명으로 맞춰요(수정 화면이 범위 밖 값으로 시작하지 않게).
UPDATE outings SET expected_people = 50 WHERE expected_people > 50;
