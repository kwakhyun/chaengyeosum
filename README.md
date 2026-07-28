# 챙겨썸 — Apps in Toss WebView + API

실제 앱인토스 업로드용 프로젝트입니다. 모임·참가자·준비물이 별도 HTTP API와 SQL 데이터베이스에 저장되며, 초대받은 사용자가 같은 준비 상태를 공유합니다.

프로덕션 API는 Cloudflare Workers + D1 무료 플랜에 배포하고, 로컬에서는 Vite가 `/api` 요청을 Node API 서버로 프록시합니다.

- 프로덕션 API: `https://chaengyeosum-api.kwakhyun-miniapps.workers.dev`
- 데이터베이스: Cloudflare D1 `chaengyeosum-prod` (APAC)
- 배포·비용·운영 문서: [`DEPLOYMENT.md`](./DEPLOYMENT.md)

## 실행

```bash
npm ci
npm run dev
```

- 웹: `http://localhost:5173`
- API: `http://localhost:8787`
- 데이터 파일: `server/.data/chaengyeosum.sqlite`

API와 웹을 따로 실행하려면 `npm run dev:api`, `npm run dev:web`을 사용합니다.

## 구현된 서버 기능

- 실제 SQLite 지속 저장
- 동적 모임 생성
- 추천 장소 선택과 국내 지역 직접 검색
- 초대 코드 검증과 익명 참여 세션
- 참가자별 해시 처리된 접근 토큰
- 활동 유형 5종과 날씨·장소를 함께 반영하는 스마트 준비물 추천
- 추천 준비물 18종 카탈로그와 생성 시 선택·해제
- 최대 16자 커스텀 준비물 입력
- 모임 생성 후 준비물 추가·삭제(1~15개 서버 검증)
- 준비물 목록·담당자·완료 상태 공동 반영
- 초대 참여 직후 주인 없는 준비물 하나 맡기
- 남은 준비물의 참여자별 공평한 랜덤 배정
- 생성·참여·담당 지정·완료·랜덤 배정 활동 피드
- D-1/D-Day 마지막 점검과 전원 완료 축하 카드
- 예상 인원별 준비물 수량 계산
- 모임 목록의 실시간 준비 진행률
- 친구 활동의 좋아요·응원 반응
- 진행률·미배정 항목·참여자 아바타가 포함된 공유 카드
- 날씨·인원·담당·완료 상태를 분석하는 OpenAI 출발 전 브리핑
- AI 팀 별명·핵심 빈틈·즉시 할 일 2개·공유 문구 생성
- AI 추천 준비물을 누르면 실제 목록으로 이동하고, 상태 변경 시 업데이트 안내
- 장소·날짜 기반 Open-Meteo 실제 예보
- 30분 날씨 캐시
- AI 결과 12시간 D1 캐시와 모임별 24시간 8회 생성 제한
- 추천 장소의 현재 예상 혼잡도와 근거 표시
- 서울 OpenAPI 지원 장소의 공식 실시간 혼잡도 자동 전환
- 공식·주최자·지자체 원문 출처를 검증하는 AI 여름 행사 검색
- 행사 검색 6시간 D1 캐시와 모임별 24시간 3회 제한
- 2.5초 주기 공동 상태 동기화

## 검증과 번들 생성

```bash
npm run typecheck
npm run test:api
npm run build:web
npm run build
```

성공 시 프로젝트 루트에 `chaengyeosum.ait`가 생성됩니다.

## 프로덕션 API 연결

로컬 `/api` 대신 배포한 Workers API 주소를 빌드 시 주입합니다.

```bash
VITE_API_BASE_URL=https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/api npm run build
```

Workers+D1 배포와 검증:

```bash
npm run db:migrate:local
npm run dev:worker
npm run test:worker
npm run db:migrate:remote
npm run deploy:worker
npm run test:ai-live
npm run test:intel-live
```

Node.js + SQLite API는 빠른 로컬 개발과 계약 회귀 테스트용으로 계속 유지합니다.

## AI 브리핑 운영

OpenAI 키는 클라이언트 번들이나 D1에 저장하지 않고 Worker secret으로만
관리합니다.

```bash
npx wrangler secret put OPENAI_API_KEY
```

- 모델: `gpt-5.6-terra`
- API: Responses API + strict JSON Schema, `store: false`
- 개인정보 최소화: 참가자 이름을 모델 입력에서 제외
- 호출 시점: 사용자가 `AI 브리핑 만들기`를 누른 경우에만 생성
- 송신 위치: 미국 동부 위치 힌트를 준 SQLite Durable Object
- 이유: 한국 사용자 요청을 처리하는 홍콩 엣지의 OpenAI 지역 제한 회피
- 비용 방어: 준비 상태 지문별 12시간 재사용, 모임별 하루 8개 상태 제한

AI 행사 검색도 같은 Worker secret과 Responses API를 사용합니다. 버튼을
누를 때 장소·날짜·활동 유형만 전송하며, 참가자 이름과 준비물은 보내지
않습니다. 웹 검색 결과 URL이 OpenAI가 실제로 반환한 출처 목록에 있는
행사만 노출합니다.

서울 주요 장소의 공식 실시간 혼잡도를 사용하려면 서울 열린데이터광장에서
키를 발급받아 선택 secret을 추가합니다.

```bash
npx wrangler secret put SEOUL_OPEN_DATA_API_KEY
```

키가 없거나 서울시 지원 범위 밖이면 요일·시간·계절·장소 인기도를 조합한
참고용 값을 `예상 혼잡도`라고 명확히 표시합니다.

## 콘솔 업로드 전 필수 수정

1. 앱인토스 콘솔에서 `chaengyeosum` appName 사용 가능 여부를 확인합니다.
2. 다른 appName을 사용하면 `granite.config.ts`와 `src/App.tsx`의 `APP_NAME`을 함께 바꿉니다.
3. `public/assets/app-icon.png`을 콘솔에 업로드합니다.
4. 콘솔이 제공한 아이콘 HTTPS URL을 `granite.config.ts`의 `brand.icon`에 입력합니다.
5. 현재 Mac의 LAN 주소가 달라졌다면 `web.host`를 수정합니다.
6. 다시 `npm run build`를 실행하고 새 `.ait` 파일을 업로드합니다.

## SDK 연동

- `getTossShareLink`: 약속 딥링크 생성
- `share`: 네이티브 공유 시트 표시
- `Analytics.click`: 초대, 담당 지정, 준비 완료 행동 기록
- 스마트 추천 반영, 하나 맡기, 랜덤 배정, 준비물 편집 행동 기록
- 로컬 브라우저 fallback: 클립보드 복사

앱인토스 푸시 알림은 콘솔의 알림 템플릿 코드와 발송 서버 설정이
필요하므로 현재 번들에는 포함하지 않았습니다. D-1 카드와 활동 피드는
앱 재진입 시 바로 최신 공동 준비 상태를 보여주는 재방문 장치입니다.

## API 보안 모델

- 모임 조회에는 참여 토큰 또는 초대 코드가 필요합니다.
- 참여 토큰 원문은 DB에 저장하지 않고 SHA-256 해시만 저장합니다.
- 초대 코드로 참여하면 참여자 전용 토큰이 새로 발급됩니다.
- 프로덕션에서는 HTTPS, 요청 빈도 제한, 데이터 백업을 추가해야 합니다.
