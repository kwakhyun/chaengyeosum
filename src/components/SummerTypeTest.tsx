import { useState } from "react";
import {
  BackpackIcon,
  CameraIcon,
  ChatBubbleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  HeartIcon,
  LightningBoltIcon,
  ReloadIcon,
  RocketIcon,
} from "@radix-ui/react-icons";

import { Sheet } from "./Sheet";

export type SummerTypeKey =
  | "planner"
  | "guardian"
  | "vibe"
  | "adventurer"
  | "foodie"
  | "navigator"
  | "connector"
  | "chill";

export type SummerTypeResult = {
  key: SummerTypeKey;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  signatureItem: string;
  strengths: [string, string];
  watchOut: string;
  match: SummerTypeKey;
  image: string;
  imageAlt: string;
};

export const SUMMER_TYPE_RESULTS: Record<SummerTypeKey, SummerTypeResult> = {
  planner: {
    key: "planner",
    name: "빈틈 제로 플래너",
    shortName: "플래너",
    tagline: "약속이 잡히는 순간, 체크리스트가 열린다",
    description:
      "날짜부터 준비물 담당까지 착착 정리해 친구들이 마음 놓고 따라오게 해요.",
    signatureItem: "보조배터리",
    strengths: ["정리력 만렙", "약속 파토 방지"],
    watchOut: "단톡방 답이 늦으면 혼자 세 번쯤 계획을 고칠 수 있어요.",
    match: "adventurer",
    image: "/assets/summer-type-planner.webp",
    imageAlt:
      "체크리스트와 준비물을 완벽하게 정리하는 파란 모자의 3D 캐릭터",
  },
  guardian: {
    key: "guardian",
    name: "날씨 레이더 안전요정",
    shortName: "안전요정",
    tagline: "비 소식 30%도 그냥 지나치지 않는다",
    description:
      "날씨와 동선을 한발 먼저 보고, 모두가 편하게 놀 수 있는 빈틈을 채워요.",
    signatureItem: "선크림",
    strengths: ["센스 있는 대비", "친구 상태 스캔"],
    watchOut: "친구 가방보다 내 비상용 파우치가 더 무거울 수 있어요.",
    match: "vibe",
    image: "/assets/summer-type-guardian.webp",
    imageAlt:
      "우산과 안전 방패로 여름 날씨를 대비하는 노란 우비의 3D 캐릭터",
  },
  vibe: {
    key: "vibe",
    name: "추억 채집 낭만러",
    shortName: "낭만러",
    tagline: "준비물보다 플레이리스트가 먼저 떠오른다",
    description:
      "평범한 약속도 사진과 음악, 한마디로 오래 기억될 장면으로 만들어요.",
    signatureItem: "카메라",
    strengths: ["분위기 점화", "인생샷 포착"],
    watchOut: "사진은 백 장인데 정작 물병은 두고 올 수 있어요.",
    match: "guardian",
    image: "/assets/summer-type-vibe.webp",
    imageAlt:
      "카메라와 음악으로 여름 추억을 모으는 하트 선글라스의 3D 캐릭터",
  },
  adventurer: {
    key: "adventurer",
    name: "노필터 즉흥 탐험가",
    shortName: "탐험가",
    tagline: "지갑과 폰만 있으면 일단 출발",
    description:
      "계획 밖의 순간을 제일 재밌게 만들고, 망설이는 친구를 밖으로 이끌어요.",
    signatureItem: "슬리퍼",
    strengths: ["출발력 최고", "변수도 콘텐츠"],
    watchOut: "현장 도착 후 ‘누가 챙겼지?’를 가장 먼저 물을 수 있어요.",
    match: "planner",
    image: "/assets/summer-type-adventurer.webp",
    imageAlt:
      "휴대폰 하나 들고 바로 뛰어가는 민트색 모자의 3D 캐릭터",
  },
  foodie: {
    key: "foodie",
    name: "간식 레이더 먹잘알",
    shortName: "먹잘알",
    tagline: "메뉴가 정해져야 진짜 약속이 시작된다",
    description:
      "사람 수와 취향을 빠르게 읽고, 지칠 타이밍마다 딱 맞는 메뉴로 모임을 충전해요.",
    signatureItem: "쿨러백",
    strengths: ["메뉴 선정 천재", "당 충전 타이밍"],
    watchOut: "먹을 건 완벽한데 돗자리 담당을 깜빡할 수 있어요.",
    match: "connector",
    image: "/assets/summer-type-foodie-v1.webp",
    imageAlt:
      "과일과 샌드위치, 시원한 음료가 든 쿨러백을 챙긴 코랄색 3D 캐릭터",
  },
  navigator: {
    key: "navigator",
    name: "동선 최적화 길잡이",
    shortName: "길잡이",
    tagline: "환승·주차·그늘길까지 머릿속에 지도가 열린다",
    description:
      "복잡한 이동도 가장 덜 덥고 덜 헤매는 길로 바꿔 친구들의 체력을 아껴줘요.",
    signatureItem: "지도 앱",
    strengths: ["최단 동선 설계", "길 잃음 방지"],
    watchOut: "좋은 경로가 세 개면 고르는 데 가장 오래 걸릴 수 있어요.",
    match: "chill",
    image: "/assets/summer-type-navigator-v1.webp",
    imageAlt:
      "지도와 나침반으로 여름 모임 동선을 찾는 파란색 3D 캐릭터",
  },
  connector: {
    key: "connector",
    name: "단톡방 온도지킴이",
    shortName: "온도지킴이",
    tagline: "답장 없는 친구까지 자연스럽게 모아낸다",
    description:
      "조용한 친구의 의견도 놓치지 않고 모두가 함께 웃는 분위기를 만드는 모임의 접착제예요.",
    signatureItem: "미니 무전기",
    strengths: ["분위기 접착제", "소외 없는 모임"],
    watchOut: "모두의 의견을 듣다가 내 취향을 마지막에 말할 수 있어요.",
    match: "foodie",
    image: "/assets/summer-type-connector-v1.webp",
    imageAlt:
      "대화 풍선과 하트를 보내 친구들을 연결하는 보라색 3D 캐릭터",
  },
  chill: {
    key: "chill",
    name: "그늘 사수 휴식요정",
    shortName: "휴식요정",
    tagline: "잘 쉬어야 오래 논다는 걸 누구보다 안다",
    description:
      "그늘과 바람, 쉬는 타이밍을 기가 막히게 찾아 모두가 끝까지 기분 좋게 놀게 해요.",
    signatureItem: "쿨링 타월",
    strengths: ["체력 배분 고수", "그늘 명당 탐색"],
    watchOut: "너무 편한 자리를 찾으면 다음 코스로 가기 싫어질 수 있어요.",
    match: "navigator",
    image: "/assets/summer-type-chill-v1.webp",
    imageAlt:
      "그늘 아래 돗자리에 누워 선풍기와 시원한 음료를 즐기는 민트색 3D 캐릭터",
  },
};

const QUESTIONS: Array<{
  scene: string;
  image: string;
  imageAlt: string;
  title: string;
  answers: Array<{ label: string; type: SummerTypeKey }>;
}> = [
  {
    scene: "약속이 생긴 순간",
    image: "/assets/summer-quiz-q1-date-v1.webp",
    imageAlt: "달력과 체크리스트, 카메라를 보며 약속을 준비하는 세 친구",
    title: "여름 모임 날짜가 잡혔어요. 가장 먼저 하는 일은?",
    answers: [
      { label: "날짜·장소와 준비물을 먼저 정리한다", type: "planner" },
      { label: "사진 스폿과 플레이리스트부터 찾는다", type: "vibe" },
      { label: "조용한 친구까지 의견을 물어본다", type: "connector" },
    ],
  },
  {
    scene: "비 올 확률 40%",
    image: "/assets/summer-quiz-q2-rain-v1.webp",
    imageAlt: "맑은 하늘과 비구름 사이에서 우산과 지도를 살피는 세 친구",
    title: "당일 비 소식이 40%라면?",
    answers: [
      { label: "우산과 대체 장소까지 미리 챙긴다", type: "guardian" },
      { label: "비를 덜 맞는 이동 경로부터 찾는다", type: "navigator" },
      { label: "비 와도 추억이지. 일단 출발한다", type: "adventurer" },
    ],
  },
  {
    scene: "점심 메뉴 회의",
    image: "/assets/summer-quiz-q3-snack-v1.webp",
    imageAlt: "여름 피크닉 테이블에서 간식과 메뉴를 고르는 세 친구",
    title: "점심과 간식을 정할 때 나는?",
    answers: [
      { label: "취향과 양을 계산해 메뉴 조합을 완성한다", type: "foodie" },
      { label: "주문 시간과 담당을 보기 좋게 나눈다", type: "planner" },
      { label: "가볍게 먹고 편하게 쉬는 게 최고다", type: "chill" },
    ],
  },
  {
    scene: "만남 장소가 갑자기 변경",
    image: "/assets/summer-quiz-q4-route-v1.webp",
    imageAlt: "지도와 여러 위치 핀을 보며 새 만남 장소를 찾는 세 친구",
    title: "출발 직전 만남 장소가 바뀌었어요.",
    answers: [
      { label: "새 경로와 도착 시간을 바로 공유한다", type: "navigator" },
      { label: "헷갈리는 친구에게 따로 연락한다", type: "connector" },
      { label: "새 장소도 재밌겠다며 바로 방향을 튼다", type: "adventurer" },
    ],
  },
  {
    scene: "가방의 마지막 한 칸",
    image: "/assets/summer-quiz-q5-bag-v1.webp",
    imageAlt: "열린 여름 가방 위 카메라와 과일 간식, 선크림을 고르는 친구들",
    title: "딱 하나만 더 챙길 수 있다면?",
    answers: [
      { label: "오늘을 오래 남길 작은 카메라", type: "vibe" },
      { label: "친구들과 나눌 시원한 과일 간식", type: "foodie" },
      { label: "누군가 꼭 찾을 선크림과 상비약", type: "guardian" },
    ],
  },
  {
    scene: "친구가 20분 늦는대요",
    image: "/assets/summer-quiz-q6-late-v1.webp",
    imageAlt: "공원 시계 아래에서 늦는 친구를 기다리는 서로 다른 성향의 세 친구",
    title: "한 친구가 조금 늦는다고 연락했어요.",
    answers: [
      { label: "모두에게 상황을 알려 어색함을 없앤다", type: "connector" },
      { label: "그늘을 찾아 시원한 음료를 마시며 쉰다", type: "chill" },
      { label: "뒤 일정을 계산해 계획을 살짝 조정한다", type: "planner" },
    ],
  },
  {
    scene: "가장 뜨거운 오후 2시",
    image: "/assets/summer-quiz-q7-heat-v1.webp",
    imageAlt: "뜨거운 강변에서 급수대와 물놀이, 그늘길을 고르는 세 친구",
    title: "갑자기 모두가 더위에 지쳤어요.",
    answers: [
      { label: "물과 선크림으로 즉석 쿨다운존을 만든다", type: "guardian" },
      { label: "가까운 물놀이 구역으로 신나게 뛰어간다", type: "adventurer" },
      { label: "그늘이 이어지는 다음 동선을 찾아낸다", type: "navigator" },
    ],
  },
  {
    scene: "완벽한 여름의 엔딩",
    image: "/assets/summer-quiz-q8-ending-v1.webp",
    imageAlt: "노을 진 강변에서 사진과 간식, 휴식을 즐기며 하루를 마무리하는 친구들",
    title: "오늘을 가장 기분 좋게 마무리하는 방법은?",
    answers: [
      { label: "노을과 단체 사진으로 장면을 남긴다", type: "vibe" },
      { label: "마지막 간식과 음료를 다 같이 나눈다", type: "foodie" },
      { label: "돗자리에 누워 오늘의 바람을 즐긴다", type: "chill" },
    ],
  },
];

const STORAGE_KEY = "chaengyeosum.summer-type.v1";

function iconFor(type: SummerTypeKey) {
  if (type === "planner") return <CheckIcon aria-hidden="true" />;
  if (type === "guardian") return <LightningBoltIcon aria-hidden="true" />;
  if (type === "vibe") return <CameraIcon aria-hidden="true" />;
  if (type === "adventurer") return <RocketIcon aria-hidden="true" />;
  if (type === "foodie") return <BackpackIcon aria-hidden="true" />;
  if (type === "navigator") return <GlobeIcon aria-hidden="true" />;
  if (type === "connector") return <ChatBubbleIcon aria-hidden="true" />;
  return <HeartIcon aria-hidden="true" />;
}

export function isSummerTypeKey(value: string | null): value is SummerTypeKey {
  return (
    value === "planner" ||
    value === "guardian" ||
    value === "vibe" ||
    value === "adventurer" ||
    value === "foodie" ||
    value === "navigator" ||
    value === "connector" ||
    value === "chill"
  );
}

export function getSavedSummerType(): SummerTypeKey | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isSummerTypeKey(saved) ? saved : null;
  } catch {
    return null;
  }
}

function resolveResult(answers: SummerTypeKey[]) {
  const scores: Record<SummerTypeKey, number> = {
    planner: 0,
    guardian: 0,
    vibe: 0,
    adventurer: 0,
    foodie: 0,
    navigator: 0,
    connector: 0,
    chill: 0,
  };
  answers.forEach((answer) => {
    scores[answer] += 1;
  });
  const bestScore = Math.max(...Object.values(scores));
  const tied = (Object.keys(scores) as SummerTypeKey[]).filter(
    (key) => scores[key] === bestScore,
  );
  return (
    [...answers].reverse().find((answer) => tied.includes(answer)) ?? "planner"
  );
}

export function SummerTypeTest({
  sharedType,
  sharedName,
  onTrack,
  onShare,
  onResultChange,
}: {
  sharedType: SummerTypeKey | null;
  sharedName: string;
  onTrack: (name: string, params?: Record<string, string | number>) => void;
  onShare: (result: SummerTypeResult) => Promise<"shared" | "copied">;
  onResultChange: (result: SummerTypeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<SummerTypeKey[]>([]);
  const [resultKey, setResultKey] = useState<SummerTypeKey | null>(
    getSavedSummerType,
  );
  const [showResult, setShowResult] = useState(false);
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "shared" | "copied"
  >("idle");
  const sharedResult = sharedType ? SUMMER_TYPE_RESULTS[sharedType] : null;
  const result = resultKey ? SUMMER_TYPE_RESULTS[resultKey] : null;
  const currentQuestion = QUESTIONS[questionIndex];
  const progress = ((questionIndex + 1) / QUESTIONS.length) * 100;
  const match = result ? SUMMER_TYPE_RESULTS[result.match] : null;

  const entryCopy = sharedResult
    ? {
        label: "친구 결과 도착",
        title: `${sharedName ? `${sharedName}님은` : "친구는"} ‘${sharedResult.shortName}’`,
        description: "나는 어떤 여름 준비 캐릭터인지 1분 만에 확인해요.",
        action: "나도 테스트하기",
      }
    : result
      ? {
          label: "내 여름 캐릭터",
          title: `나는 ‘${result.shortName}’`,
          description: "결과를 다시 보고 친구와 서로 비교해보세요.",
          action: "결과 다시 보기",
        }
      : {
          label: "1분 성향 테스트",
          title: "여름 모임에서 나는 어떤 캐릭터?",
          description: "8개 상황에 답하고 8종 캐릭터 중 내 유형을 찾아보세요.",
          action: "테스트하기",
        };

  const start = () => {
    setQuestionIndex(0);
    setAnswers([]);
    setShowResult(false);
    setShareState("idle");
    setOpen(true);
    onTrack("summer_type_started", {
      entry: sharedResult ? "friend_result" : result ? "saved_result" : "home",
    });
  };

  const openSavedResult = () => {
    if (sharedResult || !result) {
      start();
      return;
    }
    setShowResult(true);
    setShareState("idle");
    setOpen(true);
    onTrack("summer_type_result_reopened", { result: result.key });
  };

  const answer = (type: SummerTypeKey) => {
    const nextAnswers = [...answers, type];
    onTrack("summer_type_answered", {
      question: questionIndex + 1,
      choice: type,
    });
    if (questionIndex < QUESTIONS.length - 1) {
      setAnswers(nextAnswers);
      setQuestionIndex((current) => current + 1);
      return;
    }
    const nextResult = resolveResult(nextAnswers);
    setAnswers(nextAnswers);
    setResultKey(nextResult);
    setShowResult(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextResult);
    } catch {
      // 저장 실패가 테스트 완료를 막지 않게 해요.
    }
    onResultChange(nextResult);
    onTrack("summer_type_completed", { result: nextResult });
  };

  const goBack = () => {
    if (questionIndex === 0) return;
    setAnswers((current) => current.slice(0, -1));
    setQuestionIndex((current) => current - 1);
  };

  const restart = () => {
    setQuestionIndex(0);
    setAnswers([]);
    setShowResult(false);
    setShareState("idle");
    onTrack("summer_type_restarted", {
      previous_result: resultKey ?? "none",
    });
  };

  const shareResult = async () => {
    if (!result || shareState === "sharing") return;
    setShareState("sharing");
    try {
      const nextState = await onShare(result);
      setShareState(nextState);
    } catch {
      setShareState("idle");
    }
  };

  return (
    <>
      <button
        className={`summer-type-entry${
          sharedResult ? " summer-type-entry--shared" : ""
        }`}
        type="button"
        onClick={openSavedResult}
      >
        <span className="summer-type-entry__copy">
          <span className="summer-type-entry__label">{entryCopy.label}</span>
          <strong>{entryCopy.title}</strong>
          <span>{entryCopy.description}</span>
          <b>
            {entryCopy.action}
            <ChevronRightIcon aria-hidden="true" />
          </b>
        </span>
        <span className="summer-type-entry__characters" aria-hidden="true">
          {(sharedResult
            ? [sharedResult.key, sharedResult.match]
            : (["planner", "foodie", "connector", "chill"] as SummerTypeKey[])
          ).map((type) => (
            <i
              className={`summer-type-character summer-type-character--${type}`}
              key={type}
            >
              {iconFor(type)}
            </i>
          ))}
        </span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        resetScrollKey={showResult ? `result-${resultKey}` : questionIndex}
        className={`summer-type-sheet ${showResult ? "is-result" : "is-quiz"}`}
        title={showResult ? "나의 여름 준비 캐릭터" : "여름 모임 성향 테스트"}
        description={
          showResult
            ? "친구에게 보내 서로의 준비 스타일을 비교해보세요."
            : "고민 말고, 더 나다운 답을 골라주세요."
        }
      >
        {showResult && result && match ? (
          <div className="summer-type-result">
            <article
              className={`summer-type-result-card summer-type-result-card--${result.key}`}
              aria-label={`테스트 결과 ${result.name}`}
            >
              <div className="summer-type-result-card__top">
                <span>나의 여름 준비 유형</span>
                <b>챙겨썸</b>
              </div>
              <div className="summer-type-result-card__visual">
                <img
                  src={result.image}
                  alt={result.imageAlt}
                  draggable={false}
                />
                <span>{result.shortName}</span>
              </div>
              <div className="summer-type-result-card__copy">
                <p>{result.tagline}</p>
                <h3>{result.name}</h3>
                <div className="summer-type-result-card__chips">
                  {result.strengths.map((strength) => (
                    <span key={strength}>{strength}</span>
                  ))}
                </div>
                <div className="summer-type-result-card__item">
                  <span>나의 시그니처 준비물</span>
                  <strong>{result.signatureItem}</strong>
                </div>
              </div>
            </article>

            <button
              className="sheet-primary summer-type-share"
              type="button"
              disabled={shareState === "sharing"}
              onClick={() => void shareResult()}
            >
              {shareState === "shared" || shareState === "copied" ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {shareState === "sharing"
                ? "공유 링크 만드는 중…"
                : shareState === "shared"
                  ? "친구에게 공유했어요"
                  : shareState === "copied"
                    ? "결과 링크를 복사했어요"
                    : "친구에게 결과 공유하기"}
            </button>

            <div className="summer-type-result__story">
              <strong>모임에서 나는</strong>
              <p>{result.description}</p>
            </div>

            <div className="summer-type-result__watch">
              <LightningBoltIcon aria-hidden="true" />
              <div>
                <strong>귀여운 주의점</strong>
                <p>{result.watchOut}</p>
              </div>
            </div>

            <div className="summer-type-match">
              <span className={`summer-type-character summer-type-character--${match.key}`}>
                {iconFor(match.key)}
              </span>
              <div>
                <span>찰떡 준비 파트너</span>
                <strong>{match.name}</strong>
              </div>
              <p>친구에게 보내 진짜 찰떡인지 확인해보세요.</p>
            </div>

            <button
              className="summer-type-restart"
              type="button"
              onClick={restart}
            >
              <ReloadIcon aria-hidden="true" />
              다시 해보기
            </button>
          </div>
        ) : (
          <div className="summer-type-quiz">
            <div className="summer-type-progress">
              <span>
                {questionIndex + 1} / {QUESTIONS.length}
              </span>
              <div
                role="progressbar"
                aria-label="성향 테스트 진행률"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <i style={{ width: `${progress}%` }} />
              </div>
            </div>
            <figure className="summer-type-question-visual" key={currentQuestion.image}>
              <img
                src={currentQuestion.image}
                alt={currentQuestion.imageAlt}
                draggable={false}
              />
              <figcaption>{currentQuestion.scene}</figcaption>
            </figure>
            <fieldset key={questionIndex}>
              <legend>{currentQuestion.title}</legend>
              <div>
                {currentQuestion.answers.map((choice, index) => (
                  <button
                    type="button"
                    key={choice.type}
                    onClick={() => answer(choice.type)}
                  >
                    <span>{index + 1}</span>
                    <strong>{choice.label}</strong>
                    <ChevronRightIcon aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>
            {questionIndex > 0 ? (
              <button
                className="summer-type-back"
                type="button"
                onClick={goBack}
              >
                <ChevronLeftIcon aria-hidden="true" />
                이전 질문
              </button>
            ) : null}
          </div>
        )}
      </Sheet>
    </>
  );
}
