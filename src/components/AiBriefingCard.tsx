import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  MagicWandIcon,
  PersonIcon,
  ReloadIcon,
  SunIcon,
} from "@radix-ui/react-icons";

import type {
  AiBriefingAction,
  AiOutingBriefing,
} from "../types";

const ACTION_LABELS = {
  assign: "담당 정하기",
  complete: "준비 완료",
  weather: "날씨 대비",
  meetup: "모임 점검",
} as const;

function ActionIcon({ kind }: { kind: AiBriefingAction["kind"] }) {
  if (kind === "assign") return <PersonIcon aria-hidden="true" />;
  if (kind === "complete") return <CheckIcon aria-hidden="true" />;
  if (kind === "weather") return <SunIcon aria-hidden="true" />;
  return <CalendarIcon aria-hidden="true" />;
}

function BriefingAction({
  action,
  onFocusItem,
}: {
  action: AiBriefingAction;
  onFocusItem: (itemKey: string) => void;
}) {
  const content = (
    <>
      <span className="ai-briefing-action__icon">
        <ActionIcon kind={action.kind} />
      </span>
      <span>
        <small>{ACTION_LABELS[action.kind]}</small>
        <strong>{action.title}</strong>
        <p>{action.reason}</p>
      </span>
    </>
  );

  return action.targetItemKey ? (
    <button
      className="ai-briefing-action is-linked"
      type="button"
      onClick={() => onFocusItem(action.targetItemKey as string)}
    >
      {content}
      <b>목록 보기</b>
    </button>
  ) : (
    <div className="ai-briefing-action">{content}</div>
  );
}

export function AiBriefingCard({
  briefing,
  loading,
  error,
  stale,
  onGenerate,
  onShare,
  onFocusItem,
}: {
  briefing: AiOutingBriefing | null;
  loading: boolean;
  error: string;
  stale: boolean;
  onGenerate: () => void;
  onShare: () => void;
  onFocusItem: (itemKey: string) => void;
}) {
  return (
    <section
      className={`ai-briefing-card${briefing ? " has-result" : ""}`}
      aria-labelledby="ai-briefing-title"
      aria-busy={loading}
    >
      <div className="ai-briefing-card__heading">
        <span>
          <MagicWandIcon aria-hidden="true" />
        </span>
        <div>
          <p>OPENAI BRIEFING</p>
          <h2 id="ai-briefing-title">AI 출발 전 브리핑</h2>
        </div>
        {briefing ? <b>준비 상태 분석</b> : null}
      </div>

      {!briefing && !loading ? (
        <div className="ai-briefing-intro">
          <strong>우리 모임, 지금 출발해도 괜찮을까요?</strong>
          <p>
            실제 날씨와 준비 상황을 읽고 팀 별명, 빈틈, 지금 할 일
            2개를 재치 있게 알려드려요.
          </p>
          <button type="button" onClick={onGenerate}>
            <MagicWandIcon aria-hidden="true" />
            AI 브리핑 만들기
          </button>
          <small>
            모임 정보와 준비 상태만 전송해요. 참가자 이름은 보내지
            않아요.
          </small>
        </div>
      ) : null}

      {loading ? (
        <div className="ai-briefing-loading" role="status">
          <span />
          <span />
          <span />
          <p>날씨와 준비 상태를 함께 살펴보고 있어요…</p>
        </div>
      ) : null}

      {error && !loading ? (
        <div className="ai-briefing-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onGenerate}>
            <ReloadIcon aria-hidden="true" />
            다시 시도
          </button>
        </div>
      ) : null}

      {briefing && !loading ? (
        <div className="ai-briefing-result">
          {stale ? (
            <div className="ai-briefing-stale">
              준비 상태가 달라졌어요. 새 브리핑으로 업데이트할 수 있어요.
            </div>
          ) : null}
          <div className="ai-briefing-alias">
            <small>AI가 붙인 우리 팀 별명</small>
            <strong>“{briefing.teamAlias}”</strong>
          </div>
          <h3>{briefing.headline}</h3>
          <p className="ai-briefing-verdict">{briefing.verdict}</p>
          <div className="ai-briefing-actions">
            {briefing.actions.map((action, index) => (
              <BriefingAction
                action={action}
                key={`${action.kind}-${index}`}
                onFocusItem={onFocusItem}
              />
            ))}
          </div>
          <blockquote>
            <span>오늘의 반전</span>
            {briefing.plotTwist}
          </blockquote>
          <div className="ai-briefing-footer">
            <button type="button" onClick={onShare}>
              <CopyIcon aria-hidden="true" />
              결과 공유하기
            </button>
            {stale ? (
              <button type="button" onClick={onGenerate}>
                <ReloadIcon aria-hidden="true" />
                업데이트
              </button>
            ) : null}
          </div>
          <small className="ai-briefing-disclosure">
            AI 결과는 참고용이에요. 출발 전 실제 상황을 한 번 더 확인해
            주세요.
          </small>
        </div>
      ) : null}
    </section>
  );
}
