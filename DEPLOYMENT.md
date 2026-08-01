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
