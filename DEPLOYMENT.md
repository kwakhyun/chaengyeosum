# 챙겨썸 프로덕션 API 배포

## 선택한 구성

- API: Cloudflare Workers `chaengyeosum-api`
- 데이터베이스: Cloudflare D1 `chaengyeosum-prod`
- 리전 힌트: APAC
- URL: `https://chaengyeosum-api.kwakhyun-miniapps.workers.dev`
- 배포 방식: Wrangler

## 비용 판단

2026-07-28 공식 가격 기준으로 Cloudflare Workers+D1 무료 플랜을 선택했다.

- D1 무료 한도: 하루 500만 행 읽기, 하루 10만 행 쓰기, 총 5GB
- D1은 유휴 시간에 비용이 발생하지 않는다.
- Fly.io 최소 256MB 머신은 리전에 따라 약 월 $2 수준이며 1GB 볼륨은 월 $0.15가 추가된다.
- Railway Hobby는 최소 월 $5다.
- Render 무료 웹 서비스에는 영구 디스크를 붙일 수 없다.

챙겨썸의 초기 트래픽과 작은 체크리스트 레코드 크기에서는 Cloudflare 무료 한도로 충분할 가능성이 높다. 실제 사용량은 Cloudflare 대시보드의 Workers와 D1 지표에서 확인한다.

## 배포 명령

```bash
npm run db:migrate:remote
npm run deploy:worker
```

새 마이그레이션은 `migrations`에 순번 SQL 파일로 추가한 뒤 위 순서대로 적용한다.

`0005_revisions_rate_limits.sql`은 ETag용 `outings.revision`, 요청 제한 테이블, 조회 인덱스를 추가하고 기존 `starts_at`을 KST ISO 형식으로 정규화한다. 새 Worker는 이 컬럼과 테이블을 사용하므로 **반드시 마이그레이션을 먼저 적용한 뒤 배포**한다.

`0005`는 예전 서버가 저장한 50명 초과 `expected_people`도 50으로 맞춘다. 아직 운영 D1에 적용하지 않았으므로 이 내용까지 포함해 한 번에 적용한다.

`wrangler.toml`의 `[triggers] crons = ["17 19 * * *"]`(매일 04:17 KST)로 오래된 모임·캐시·요청 제한 기록을 정리한다. 로컬에서는 `npx wrangler dev --test-scheduled` 후 `/__scheduled`로 확인할 수 있다.

## 요청 제한 설정

- 사람 기준 한도는 사용자 키(`x-chaengyeosum-user-key`) 버킷과 IP(`CF-Connecting-IP`) 버킷을 함께 소비한다. IP 한도는 통신사 NAT를 고려해 사용자 키 한도의 3배이며, 사용자 키가 없는 요청은 같은 IP 버킷만 쓴다. IPv6는 기기 한 대가 `/64`를 통째로 받는 경우가 많아 `/64`(앞 4개 hextet) 단위로 묶어 세고, IPv4에 매핑된 IPv6 주소(`::ffff:a.b.c.d`)는 IPv4로 센다.
- AI 브리핑과 여름 행사 검색은 OpenAI를 부르기 전에 서비스 전체 하루 버킷(`openai-global`, KST 자정 기준)을 함께 소비한다. 기본 600회이며 `wrangler.toml`의 `[vars] AI_GLOBAL_DAILY_LIMIT`로 바꾼 뒤 배포한다. 1 이상의 정수가 아니면 기본값을 쓴다. OpenAI 프로젝트 사용량 한도도 함께 걸어 두는 것을 권장한다.
- Node API(`server/`)를 프록시 뒤에 배포할 때만 `TRUST_PROXY`를 설정한다. 설정하지 않으면 클라이언트가 보낸 `CF-Connecting-IP`/`X-Forwarded-For`를 무시하고 소켓 주소로 센다. 프록시 뒤에서 끄면 모든 사용자가 프록시 주소 하나를 함께 쓰므로 서비스 전체가 IP 한도 하나에 묶인다.
  - `TRUST_PROXY=1`(또는 `true`): 앞단 프록시 1대(nginx `$proxy_add_x_forwarded_for`, ALB, Fly.io, Render, Cloud Run 등). 프록시가 `X-Forwarded-For` 오른쪽에 덧붙인 값을 클라이언트 IP로 쓴다. 클라이언트가 보낸 왼쪽 값과 `CF-Connecting-IP`는 무시한다.
  - `TRUST_PROXY=2` 등: 프록시가 여러 대(예: CDN → 로드밸런서)면 그 수를 넣는다. `X-Forwarded-For` 오른쪽에서 그 수만큼 센 값을 쓴다.
  - `TRUST_PROXY=cloudflare`: Cloudflare가 넣는 `CF-Connecting-IP`를 쓴다. 원본 서버를 Cloudflare에서만 접근할 수 있게 막아 둔 경우에만 쓴다(직접 접근할 수 있으면 클라이언트가 이 헤더를 마음대로 보낼 수 있다).
  - 그 밖의 값은 무시하고(꺼진 것으로 보고) 시작할 때 `trust_proxy_ignored` 경고를 남긴다.
- Node API의 OpenAI 한도는 `AI_GLOBAL_DAILY_LIMIT` 환경 변수로 바꾼다.

## 검증

```bash
curl https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/api/health
WORKER_API_URL=https://chaengyeosum-api.kwakhyun-miniapps.workers.dev npm run test:worker
```

정상 헬스체크:

```json
{
  "ok": true,
  "service": "chaengyeosum-api",
  "storage": "cloudflare-d1"
}
```

## 앱인토스 번들 연결

```bash
VITE_API_BASE_URL=https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/api \
VITE_TOSS_USER_DATA_KEY=cud_콘솔에서_복사한_키 \
npm run build
```

상대 경로 `/api`로 빌드하면 앱인토스 운영 환경에서 Worker에 연결되지 않으므로 API 주소를 반드시 지정한다. 사용자 이름 자동 입력을 사용하려면 콘솔의 `유저정보 불러오기`에서 이름 항목을 등록하고 발급된 `cud_` 키도 함께 지정한다.

## 운영 명령

```bash
npx wrangler deployments list
npx wrangler tail
npx wrangler d1 migrations list chaengyeosum-prod --remote
```

참여 토큰은 원문을 D1에 저장하지 않고 SHA-256 해시만 저장한다. 모든 운영 요청은 HTTPS를 사용하며, 요청 본문은 32KB로 제한한다.
