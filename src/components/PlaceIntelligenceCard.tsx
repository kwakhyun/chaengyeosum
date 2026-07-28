import {
  ExternalLinkIcon,
  GlobeIcon,
  MagicWandIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";

import type { CrowdSignal, SummerEventSearch } from "../types";
import { CrowdPulseVisual } from "./CrowdPulseVisual";

function observedLabel(value: string, live: boolean) {
  if (!live) return "현재 시간 기준 계산";
  const parsed = new Date(value.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }
  return value;
}

export function PlaceIntelligenceCard({
  placeName,
  crowd,
  crowdLoading,
  crowdError,
  events,
  eventLoading,
  eventError,
  onRefreshCrowd,
  onSearchEvents,
}: {
  placeName: string;
  crowd: CrowdSignal | null;
  crowdLoading: boolean;
  crowdError: string;
  events: SummerEventSearch | null;
  eventLoading: boolean;
  eventError: string;
  onRefreshCrowd: () => void;
  onSearchEvents: () => void;
}) {
  return (
    <section
      className="place-intelligence-card"
      aria-labelledby="place-intelligence-title"
    >
      <div className="place-intelligence-card__heading">
        <span>
          <GlobeIcon aria-hidden="true" />
        </span>
        <div>
          <p>PLACE PULSE</p>
          <h2 id="place-intelligence-title">지금 이곳, 얼마나 붐빌까?</h2>
        </div>
        <button
          type="button"
          aria-label="혼잡도 새로고침"
          disabled={crowdLoading}
          onClick={onRefreshCrowd}
        >
          <ReloadIcon aria-hidden="true" />
        </button>
      </div>

      {crowdLoading && !crowd ? (
        <div className="crowd-loading" role="status">
          <span aria-hidden="true" />
          <p>현재 혼잡 신호를 분석하고 있어요…</p>
        </div>
      ) : crowd ? (
        <div className={`crowd-result crowd-result--${crowd.level}`}>
          <div className="crowd-result__top">
            <div>
              <span
                className={`crowd-source-badge crowd-source-badge--${crowd.mode}`}
              >
                {crowd.mode === "live" ? "공식 실시간" : "예상"}
              </span>
              <strong>{placeName}</strong>
            </div>
            <small>
              {observedLabel(crowd.observedAt, crowd.mode === "live")}
            </small>
          </div>
          <CrowdPulseVisual crowd={crowd} placeName={placeName} />
          <p>{crowd.summary}</p>
          <ul>
            {crowd.reasons.slice(0, 2).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {crowd.mode === "live" && crowd.timingAdvice ? (
            <div className="crowd-timing-advice">
              <small>SMART TIMING</small>
              <strong>{crowd.timingAdvice.verdict}</strong>
              <p>{crowd.timingAdvice.summary}</p>
            </div>
          ) : null}
          {crowd.mode === "live" &&
          (crowd.forecast?.length ?? 0) > 0 ? (
            <div className="crowd-forecast">
              <div>
                <strong>앞으로 12시간</strong>
                <span>서울시 혼잡 전망</span>
              </div>
              <ol aria-label="시간대별 예상 혼잡도">
                {crowd.forecast?.map((item) => (
                  <li
                    className={`crowd-forecast__item crowd-forecast__item--${item.level}`}
                    key={item.time}
                  >
                    <time dateTime={item.time}>
                      {item.time.slice(11, 16)}
                    </time>
                    <i aria-hidden="true" />
                    <strong>{item.label}</strong>
                    <small>{item.populationRange}</small>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className="crowd-result__source">
            <span>{crowd.source.note}</span>
            {crowd.source.url ? (
              <a
                href={crowd.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {crowd.source.name}
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            ) : (
              <b>{crowd.source.name}</b>
            )}
          </div>
          {crowd.mode === "estimate" && crowd.liveSupported ? (
            <small className="crowd-live-ready">
              서울 OpenAPI 연결 시 공식 실시간 값으로 자동 전환돼요.
            </small>
          ) : null}
        </div>
      ) : (
        <div className="place-intelligence-error" role="alert">
          <p>{crowdError || "혼잡도를 불러오지 못했어요."}</p>
          <button type="button" onClick={onRefreshCrowd}>
            다시 확인
          </button>
        </div>
      )}

      <div className="summer-events">
        <div className="summer-events__heading">
          <span>
            <MagicWandIcon aria-hidden="true" />
          </span>
          <div>
            <strong>AI가 찾는 근처 여름 행사</strong>
            <small>진행 중·예정 행사만 원문으로 확인해요</small>
          </div>
        </div>

        {events ? (
          <>
            <div className="summer-events__summary">
              <strong>{events.headline}</strong>
              {events.searchSummary ? <p>{events.searchSummary}</p> : null}
            </div>
            {events.events.length > 0 ? (
              <ul className="summer-event-list">
                {events.events.map((event) => (
                  <li key={`${event.title}-${event.sourceUrl}`}>
                    <div>
                      <span>{event.dateLabel}</span>
                      <strong>{event.title}</strong>
                      <small>{event.venue}</small>
                    </div>
                    <p>{event.why}</p>
                    <a
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {event.sourceTitle}
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="summer-events__empty">{events.noEventMessage}</p>
            )}
            <button
              className="summer-events__refresh"
              type="button"
              disabled={eventLoading}
              onClick={onSearchEvents}
            >
              <ReloadIcon aria-hidden="true" />
              {eventLoading ? "다시 확인 중…" : "행사 다시 확인"}
            </button>
          </>
        ) : (
          <button
            className="summer-events__search"
            type="button"
            disabled={eventLoading}
            onClick={onSearchEvents}
          >
            <MagicWandIcon aria-hidden="true" />
            {eventLoading ? "공식 출처를 검색 중이에요…" : "AI로 행사 찾아보기"}
          </button>
        )}
        {eventError ? (
          <p className="summer-events__error" role="alert">
            {eventError}
          </p>
        ) : null}
        <small className="summer-events__privacy">
          장소·날짜·활동 유형만 전송하며, 참가자 이름과 준비물은 보내지 않아요.
        </small>
      </div>
    </section>
  );
}
