# 챙겨썸 샌드박스 테스트 준비

작성 기준일: 2026-07-28

## 현재 준비 상태

| 항목 | 값·상태 |
|---|---|
| appName | `chaengyeosum` |
| 실행 스킴 | `intoss://chaengyeosum` |
| SDK | `@apps-in-toss/web-framework` 2.10.7 |
| 로컬 Web 서버 | `0.0.0.0:5173` |
| 로컬 API 서버 | `0.0.0.0:8787` |
| 현재 Mac 로컬 IP | `192.168.219.102` |
| granite web.host | `192.168.219.102` |
| 배포 API | `https://chaengyeosum-api.kwakhyun-miniapps.workers.dev` |
| 배포 로고 | `https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/logo-light-600x600.png` |
| AIT 번들 | `chaengyeosum.ait` |
| AIT SHA-256 | `40d4f186f0447060aa0c83b34150d424c55bf75a240433c3e5207d14d3f4c986` |

`granite.config.ts`의 앱 이름·브랜드 이름·브랜드 색·로고 URL을 콘솔 등록 정보와 일치시켰어요.

## 자동 검증 결과

- TypeScript 검사: 통과
- API 통합 테스트: 6/6 통과
- 배포 Worker 연동 테스트: 통과
  - D1 연결
  - 모임 생성
  - 초대 참여
  - 준비물 담당·완료 처리
  - 친구 소식 반응
  - 랜덤 담당 배정
- AIT 빌드: 통과
  - RN 0.84 빌드
  - RN 0.72.6 빌드
- 배포 로고: HTTP 200, `image/png`

## iOS 실기기 테스트

1. Mac과 iPhone을 같은 Wi‑Fi에 연결해요.
2. 프로젝트에서 `npm run dev`를 실행해요.
3. 최신 앱인토스 샌드박스 앱을 설치해요. iOS 16 이상이 필요해요.
4. 콘솔에서 쓰는 개인 토스 비즈니스 계정으로 로그인하고 `챙겨썸`을 선택해요.
5. iPhone의 로컬 네트워크 권한을 허용해요.
6. 샌드박스 서버 주소에 `192.168.219.102`를 입력해요.
7. `intoss://chaengyeosum`을 열어요.

Wi‑Fi가 바뀌면 `ipconfig getifaddr en0`으로 IP를 다시 확인하고 `granite.config.ts`의 `web.host`도 바꿔요.

## Android 실기기·에뮬레이터 테스트

1. 기기를 USB로 연결해요.
2. 아래 포트를 연결해요.

```sh
adb reverse tcp:8081 tcp:8081
adb reverse tcp:5173 tcp:5173
```

3. 최신 샌드박스 앱에서 `intoss://chaengyeosum`을 열어요.

## 필수 수동 QA

| 번호 | 시나리오 | 기대 결과 |
|---:|---|---|
| 1 | 앱 최초 진입 | 공통 내비게이션의 로고·앱 이름이 정상 표시되고 화면 안 브랜드 헤더와 과도하게 중복되지 않아요. |
| 2 | 새 모임 만들기 | 날짜·활동·인원·추천 장소를 고르면 날씨 맞춤 준비물이 표시돼요. |
| 3 | 장소 직접 검색 | 검색 결과를 고르면 장소명·좌표가 모임에 저장돼요. |
| 4 | 준비물 편집 | 추천 항목 선택, 직접 추가, 삭제, 1~15개 제한이 동작해요. |
| 5 | 친구 초대 | 다른 기기에서 링크를 열고 이름을 입력해 참여할 수 있어요. |
| 6 | 하나 맡기 | 초대받은 친구가 담당자 없는 준비물을 맡고 양쪽 화면에 반영돼요. |
| 7 | 랜덤 분배 | 담당자 없는 준비물이 참여자에게 나뉘어요. |
| 8 | 진행률 | 완료 체크 후 진행률과 출발 전 점검 수량이 바뀌어요. |
| 9 | 공유 | 진행률 공유 카드와 초대 링크가 정상 생성돼요. |
| 10 | 내비게이션 | 뒤로가기·닫기·홈 이동에서 이중 내비게이션이나 막힘이 없어요. |
| 11 | 오류 상태 | API 차단·느린 네트워크·잘못된 초대 링크에서 복구 안내가 보여요. |
| 12 | 화면 크기 | 작은 iPhone과 Android에서 버튼·텍스트·바텀시트가 잘리거나 겹치지 않아요. |

샌드박스에서 지원하지 않는 내비게이션 바 공유 등은 콘솔의 `출시하기` 메뉴에서 `.ait` 번들을 올린 뒤 QR 코드로 토스앱에서 확인해요.

## 콘솔 제출 순서

1. 앱 정보에 `APP-INFO.md` 문안을 입력해요.
2. `final/` 폴더의 로고·스크린샷·썸네일을 업로드해요.
3. `chaengyeosum.ait`을 첫 버전으로 등록해요.
4. 콘솔 QR로 토스앱 최종 테스트를 해요.
5. 수동 QA 결과를 기록하고 앱 정보 검토를 요청해요.

## 사업자등록 판단

챌린지 참여와 기본 미니앱 출시에 사업자등록은 필수가 아니에요. 공식 챌린지 안내는 누구나 참여할 수 있다고 명시하고, 앱인토스 가이드는 개인 비사업자도 미니앱을 출시할 수 있다고 안내해요.

현재 챙겨썸은 토스 로그인·결제·광고·프로모션을 사용하지 않으므로 사업자 없이 출품할 수 있어요. 이후 토스 로그인, 비즈월렛, 프로모션, 인앱 광고, 인앱 결제, 토스페이를 붙이려면 개인 또는 법인 사업자 등록이 필요해요.

## 근거

- [테스트앱(샌드박스)](https://developers-apps-in-toss.toss.im/development/test/sandbox.html)
- [사업자 등록하기](https://developers-apps-in-toss.toss.im/prepare/register-business.html)
- [콘솔에서 앱 등록하기](https://developers-apps-in-toss.toss.im/prepare/console-workspace.html)
- [7월 바이브코딩 챌린지](https://toss.im/apps-in-toss/blog/2607_vibecoding_challenge)
