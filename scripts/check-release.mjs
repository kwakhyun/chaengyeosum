import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("src/App.tsx");
const sheet = read("src/components/Sheet.tsx");
const popularSummerPlaces = read("src/components/PopularSummerPlaces.tsx");
const styles = read("src/styles.css");
const config = read("granite.config.ts");
const html = read("index.html");
const source = [
  app,
  styles,
  ...[
    "src/api.ts",
    "src/session.ts",
    "src/components/Sheet.tsx",
    "src/components/SummerTypeTest.tsx",
  ].map(read),
].join("\n");

const checks = [
  {
    name: "앱 이름과 appName이 콘솔 등록값과 일치",
    pass:
      config.includes('appName: "chaengyeosum"') &&
      config.includes('displayName: "챙겨썸"'),
  },
  {
    name: "비게임 공통 내비게이션 바 제목과 뒤로가기 사용",
    pass:
      config.includes("withBackButton: true") &&
      config.includes("withTitle: true"),
  },
  {
    name: "미니앱 자체 상단 브랜드·뒤로가기 UI 제거",
    pass:
      !app.includes('className="brand-pill"') &&
      !app.includes('className="hero-back-button"') &&
      !styles.includes(".hero-back-button"),
  },
  {
    name: "앱 진입 시 바텀시트 자동 노출 없음",
    pass:
      app.includes("const [createOpen, setCreateOpen] = useState(false)") &&
      app.includes("const [joinOpen, setJoinOpen] = useState(false)"),
  },
  {
    name: "텍스트 입력 중 시트 포커스 유지",
    pass:
      sheet.includes("const onCloseRef = useRef(onClose)") &&
      sheet.includes("onCloseRef.current()") &&
      !sheet.includes("}, [onClose, open])"),
  },
  {
    name: "하단 내비게이션이 화면 바닥에 고정",
    pass:
      /\.home-bottom-nav\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*0;/.test(
        styles,
      ) &&
      styles.includes("height: 66px") &&
      styles.includes("padding: 6px 12px 8px") &&
      !styles.includes(
        "padding: 6px 12px max(8px, env(safe-area-inset-bottom))",
      ),
  },
  {
    name: "Android WebView 하단 안전영역 중복 적용 없음",
    pass:
      !styles.includes("env(safe-area-inset-bottom)") &&
      styles.includes("padding: 14px 2px 24px") &&
      styles.includes("padding: 24px 20px"),
  },
  {
    name: "홈 히어로가 강과 피크닉 중심으로 압축",
    pass:
      styles.includes("min-height: 360px") &&
      styles.includes("height: 118%") &&
      styles.includes("object-position: center bottom"),
  },
  {
    name: "앱인토스 네이티브 뒤로가기 처리",
    pass:
      app.includes('graniteEvent.addEventListener("backEvent"') &&
      app.includes("new Event(APP_BACK_EVENT") &&
      app.includes("closeView()"),
  },
  {
    name: "공유 링크 전용 이미지와 문구 연결",
    pass:
      app.includes("SHARE_OG_IMAGE_URL") &&
      app.match(/getTossShareLink\([\s\S]*?SHARE_OG_IMAGE_URL/g)?.length ===
        3 &&
      app.includes("같이 챙길래?"),
  },
  {
    name: "앱 내 기능 진입점 제공",
    pass:
      app.includes('requestedTab === "places"') &&
      app.includes('requestedTab === "type"'),
  },
  {
    name: "다양한 여름 장소 정보와 모임 생성 진입점 제공",
    pass:
      app.includes("<PopularSummerPlaces") &&
      popularSummerPlaces.includes('place.category !== "hangang"') &&
      popularSummerPlaces.includes("place.imageUrl") &&
      popularSummerPlaces.includes("이 장소로 모임 만들기") &&
      popularSummerPlaces.includes("참고용 예상치"),
  },
  {
    name: "생성자 전용 모임 삭제 확인 흐름 제공",
    pass:
      app.includes("confirmDeleteOuting") &&
      app.includes("삭제하면 초대받은 친구도 더 이상") &&
      source.includes('method: "DELETE"') &&
      source.includes("removeSession"),
  },
  {
    name: "확대·축소 제스처 비활성화",
    pass:
      html.includes("maximum-scale=1.0") &&
      html.includes("user-scalable=no"),
  },
  {
    name: "공유 링크는 공개 intoss:// 스킴 사용",
    pass:
      source.includes("intoss://") &&
      !source.includes("intoss-private://"),
  },
  {
    name: "외부 코드 실행과 외부 이동용 히스토리 치환 없음",
    pass:
      !/\beval\s*\(/.test(source) &&
      !/\bnew\s+Function\b/.test(source) &&
      !source.includes("window.location.replace"),
  },
  {
    name: "비암호화 WebSocket 사용 없음",
    pass: !source.includes("ws://"),
  },
];

const bundlePath = join(root, "chaengyeosum.ait");
checks.push({
  name: "AIT 번들 생성 및 100MB 이하",
  pass:
    existsSync(bundlePath) &&
    statSync(bundlePath).size > 0 &&
    statSync(bundlePath).size <= 100 * 1024 * 1024,
});

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
}

const failed = checks.filter((check) => !check.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length}개 출시 정적 점검이 실패했어요.`);
  process.exitCode = 1;
} else {
  const bundleSize = statSync(bundlePath).size / 1024 / 1024;
  console.log(`\n정적 점검 ${checks.length}개 통과 · AIT ${bundleSize.toFixed(1)}MB`);
}
