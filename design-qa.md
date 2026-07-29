# Design QA

## Comparison target

- Source visual truth:
  - `/Users/kwakhyun/Downloads/KakaoTalk_Photo_2026-07-29-14-40-29 002.jpeg`
  - `/Users/kwakhyun/Desktop/스크린샷 2026-07-29 오후 3.33.43.png`
- Implementation screenshots:
  - `docs/qa/design-qa-sheet.png`
  - `docs/qa/design-qa-home.png`
- Combined comparison evidence:
  - `docs/qa/design-qa-sheet-comparison.png`
  - `docs/qa/design-qa-home-comparison.png`
- Viewport: 390 × 716 CSS px, device scale factor 1
- State:
  - 홈 첫 화면
  - 새 모임 만들기 시트, 1단계, 스크롤 위치 0

## Normalization

- Android source screenshot: 648 × 1404px.
- Android 앱 소유 영역을 상단 128px부터 648 × 1190px로 잘라 390 × 716px로 정규화했다.
- 구현 캡처: 390 × 716px, CSS 크기와 이미지 픽셀이 1:1이다.
- 홈 원본은 상단 히어로 영역을 같은 높이로 맞춘 전후 비교로 정규화했다.

## Findings

- 해결됨 · P1 · 새 모임 시트 하단 버튼이 폼 중간에 떠 있음
  - 원본에서는 Android WebView의 큰 안전영역 값이 시트와 액션 영역에 중복 적용돼 버튼이 실제 화면 하단보다 약 180px 위에서 고정됐다.
  - 안전영역 중복 패딩을 제거한 뒤 액션 컨테이너 하단은 viewport 716px, 버튼 하단은 692px로 측정됐다. 남은 24px은 의도한 시트 내부 여백이다.
  - 버튼 아래에 다음 입력 영역이 노출되던 기존 오류가 사라지고, 버튼이 시트 하단에 고정된다.

- 해결됨 · P2 · 홈 히어로가 지나치게 높고 하늘 비중이 큼
  - 히어로 높이를 420px에서 360px로 줄였다.
  - 배경 이미지는 높이 118%, 아래쪽 정렬로 배치해 상단 64.8px을 잘라내고 강·잔디·피크닉 소품 비중을 높였다.
  - CTA 하단과 다음 섹션 시작 사이 간격은 68px로 줄었다.

## Required fidelity surfaces

- Fonts and typography: 기존 앱의 폰트, 크기, 굵기, 줄바꿈을 유지했다. 수정으로 인한 텍스트 잘림은 없다.
- Spacing and layout rhythm: 시트 버튼은 실제 화면 하단에 정렬됐고 홈 상단은 60px 압축됐다.
- Colors and visual tokens: 브랜드 파랑, 흰색 시트, 오버레이와 카드 토큰을 변경하지 않았다.
- Image quality and asset fidelity: 기존 고해상도 `hero-picnic.png`를 재사용하고 확대·하단 정렬만 적용했다. 흐림이나 빈 영역은 없다.
- Copy and content: 사용자 문구와 단계 정보는 변경하지 않았다.

## Comparison history

1. 초기: 시트 액션이 Android 안전영역을 중복 반영해 폼 중간에 고정되고, 홈 히어로는 420px로 하늘과 CTA 아래 여백이 과도했다.
2. 수정: 모든 앱 내부 하단 안전영역 중복 계산을 제거하고, 히어로 높이·이미지 위치를 조정했다.
3. 재검증: 390 × 716에서 시트 액션 하단 716px, 홈 히어로 360px, 배경 이미지 상단 -64.8px을 확인했다.

## Follow-up polish

- 실제 토스 Android WebView에서 시스템 내비게이션 바를 포함한 최종 한 번의 기기 확인은 필요하다.

final result: passed
