import { useState } from "react";
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LightningBoltIcon,
  ReloadIcon,
  RocketIcon,
} from "@radix-ui/react-icons";

import { Sheet } from "./Sheet";

export type SummerTypeKey = "planner" | "guardian" | "vibe" | "adventurer";

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
    name: "빈틈 제로 총대장",
    shortName: "총대장",
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
};

const QUESTIONS: Array<{
  title: string;
  answers: Array<{ label: string; type: SummerTypeKey }>;
}> = [
  {
    title: "여름 모임 날짜가 잡혔어요. 가장 먼저 하는 일은?",
    answers: [
      { label: "날짜·장소와 준비물을 먼저 정리한다", type: "planner" },
      { label: "재밌는 사진과 맛집부터 단톡방에 보낸다", type: "vibe" },
    ],
  },
  {
    title: "당일 비 소식이 40%라면?",
    answers: [
      { label: "우산과 대체 장소까지 미리 챙긴다", type: "guardian" },
      { label: "비 와도 추억이지. 일단 만나고 본다", type: "adventurer" },
    ],
  },
  {
    title: "친구들이 준비물을 아직 안 골랐어요.",
    answers: [
      { label: "누가 뭘 맡을지 보기 좋게 나눈다", type: "planner" },
      { label: "혹시 모르니 빠진 건 내가 더 챙긴다", type: "guardian" },
    ],
  },
  {
    title: "가방에 마지막으로 넣고 싶은 건?",
    answers: [
      { label: "카메라·간식·플레이리스트", type: "vibe" },
      { label: "지갑과 폰이면 충분하다", type: "adventurer" },
    ],
  },
];

const STORAGE_KEY = "chaengyeosum.summer-type.v1";

function iconFor(type: SummerTypeKey) {
  if (type === "planner") return <CheckIcon aria-hidden="true" />;
  if (type === "guardian") return <LightningBoltIcon aria-hidden="true" />;
  if (type === "vibe") return <CameraIcon aria-hidden="true" />;
  return <RocketIcon aria-hidden="true" />;
}

export function isSummerTypeKey(value: string | null): value is SummerTypeKey {
  return (
    value === "planner" ||
    value === "guardian" ||
    value === "vibe" ||
    value === "adventurer"
  );
}

function getSavedResult(): SummerTypeKey | null {
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
  onTrack,
  onShare,
}: {
  sharedType: SummerTypeKey | null;
  onTrack: (name: string, params?: Record<string, string | number>) => void;
  onShare: (result: SummerTypeResult) => Promise<"shared" | "copied">;
}) {
  const [open, setOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<SummerTypeKey[]>([]);
  const [resultKey, setResultKey] = useState<SummerTypeKey | null>(
    getSavedResult,
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
        title: `친구는 ‘${sharedResult.shortName}’`,
        description: "나는 어떤 여름 준비 캐릭터인지 30초 만에 확인해요.",
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
          label: "30초 성향 테스트",
          title: "여름 모임에서 나는 어떤 캐릭터?",
          description: "4개 질문에 답하고 친구와 결과를 비교해보세요.",
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
            : (["planner", "guardian", "vibe", "adventurer"] as SummerTypeKey[])
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
