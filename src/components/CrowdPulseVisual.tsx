import type { CrowdSignal } from "../types";

const LEVEL_COPY: Record<CrowdSignal["level"], string> = {
  relaxed: "돗자리 자리 고르기 좋아요",
  normal: "조금만 둘러보면 여유 자리가 보여요",
  busy: "친구와 가까이 움직이는 게 좋아요",
  very_busy: "지금은 사람 파도가 꽉 찼어요",
};

const LEVEL_EMOJI: Record<CrowdSignal["level"], string> = {
  relaxed: "🌿",
  normal: "🙂",
  busy: "👀",
  very_busy: "🌊",
};

export function CrowdPulseVisual({
  crowd,
  placeName,
  compact = false,
}: {
  crowd: CrowdSignal;
  placeName: string;
  compact?: boolean;
}) {
  const activePeople = Math.max(
    3,
    Math.min(14, Math.round((crowd.score / 100) * 14)),
  );
  const population =
    crowd.populationRange ??
    (crowd.mode === "estimate" ? `${crowd.label}` : "집계 중");

  return (
    <div
      className={`crowd-pulse-visual crowd-pulse-visual--${crowd.level}${
        compact ? " crowd-pulse-visual--compact" : ""
      }`}
      role="img"
      aria-label={`${placeName} 현재 ${population}, 혼잡 단계 ${crowd.label}`}
    >
      <div className="crowd-pulse-visual__population">
        <small>
          {crowd.mode === "live"
            ? "지금 이 공간의 추정 인구"
            : "현재 시간대 혼잡 예상"}
        </small>
        <strong>{population}</strong>
      </div>
      <div className="crowd-pulse-visual__people" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <span
            className={index < activePeople ? "is-active" : ""}
            key={index}
          >
            <i />
            <b />
          </span>
        ))}
      </div>
      <div className="crowd-pulse-visual__verdict">
        <span aria-hidden="true">{LEVEL_EMOJI[crowd.level]}</span>
        <div>
          <strong>{crowd.label}</strong>
          <small>{LEVEL_COPY[crowd.level]}</small>
        </div>
      </div>
    </div>
  );
}
