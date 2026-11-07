import { useCallback, useEffect, useState } from "react";
import {
  BackpackIcon,
  BoxIcon,
  CameraIcon,
  CheckIcon,
  DashboardIcon,
  ExclamationTriangleIcon,
  HeartIcon,
  InfoCircledIcon,
  LayersIcon,
  LightningBoltIcon,
  MagicWandIcon,
  MobileIcon,
  ReloadIcon,
  RocketIcon,
  SpeakerLoudIcon,
  SunIcon,
  TokensIcon,
  TrashIcon,
} from "@radix-ui/react-icons";

import type { ItemOption } from "./types";

export function ItemVisual({
  visual,
  compact = false,
}: {
  visual: string;
  compact?: boolean;
}) {
  if (visual.startsWith("asset:")) {
    const filename = visual.slice("asset:".length).replaceAll("/", "");
    return (
      <img
        className={compact ? "item-image item-image--compact" : "item-image"}
        src={`/assets/${filename}`}
        alt=""
        draggable={false}
      />
    );
  }

  const iconName = visual.startsWith("icon:")
    ? visual.slice("icon:".length)
    : "custom";
  const icon =
    iconName === "sun" ? (
      <SunIcon aria-hidden="true" />
    ) : iconName === "backpack" ? (
      <BackpackIcon aria-hidden="true" />
    ) : iconName === "mobile" ? (
      <MobileIcon aria-hidden="true" />
    ) : iconName === "lightning" ? (
      <LightningBoltIcon aria-hidden="true" />
    ) : iconName === "camera" ? (
      <CameraIcon aria-hidden="true" />
    ) : iconName === "layers" ? (
      <LayersIcon aria-hidden="true" />
    ) : iconName === "heart" ? (
      <HeartIcon aria-hidden="true" />
    ) : iconName === "trash" ? (
      <TrashIcon aria-hidden="true" />
    ) : iconName === "magic-wand" ? (
      <MagicWandIcon aria-hidden="true" />
    ) : iconName === "cool" ? (
      <DashboardIcon aria-hidden="true" />
    ) : iconName === "speaker" ? (
      <SpeakerLoudIcon aria-hidden="true" />
    ) : iconName === "tokens" ? (
      <TokensIcon aria-hidden="true" />
    ) : (
      <BoxIcon aria-hidden="true" />
    );

  return (
    <span
      className={`item-icon-visual${compact ? " item-icon-visual--compact" : ""}`}
    >
      {icon}
    </span>
  );
}

export function ItemPicker({
  options,
  selectedKeys,
  disabled,
  recommendationReasons,
  onToggle,
}: {
  options: ItemOption[];
  selectedKeys: Set<string>;
  disabled?: boolean;
  recommendationReasons?: Map<string, string>;
  onToggle: (option: ItemOption) => void;
}) {
  return (
    <div className="item-option-grid">
      {options.map((option) => {
        const selected = selectedKeys.has(option.key);
        const reason = recommendationReasons?.get(option.key);
        return (
          <button
            className={`item-option${selected ? " is-selected" : ""}${
              reason ? " is-recommended" : ""
            }`}
            type="button"
            key={option.key}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(option)}
          >
            <ItemVisual visual={option.visual} compact />
            <span>{option.label}</span>
            {reason ? <small>{reason}</small> : null}
            {selected ? (
              <span className="item-option__check" aria-hidden="true">
                <CheckIcon />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function activityIcon(activityType: string) {
  if (activityType === "water-play") {
    return <BackpackIcon aria-hidden="true" />;
  }
  if (activityType === "festival") {
    return <SpeakerLoudIcon aria-hidden="true" />;
  }
  if (activityType === "camping") {
    return <DashboardIcon aria-hidden="true" />;
  }
  if (activityType === "trip") {
    return <RocketIcon aria-hidden="true" />;
  }
  return <SunIcon aria-hidden="true" />;
}

/** 날씨 상태에 맞는 아이콘이에요. 비·흐림에도 해 아이콘이 뜨지 않게 해요. */
export function WeatherIcon({ condition }: { condition?: string | null }) {
  const label = condition ?? "";
  if (label.includes("비") || label.includes("소나기")) {
    return (
      <svg viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path
          d="M4.3 9.2h6.2a2.4 2.4 0 0 0 .2-4.8 3.3 3.3 0 0 0-6.3.7 2.1 2.1 0 0 0-.1 4.1Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path
          d="M5 11l-.6 1.6M7.6 11 7 12.6M10.2 11l-.6 1.6"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (label.includes("눈")) {
    return (
      <svg viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path
          d="M7.5 2v11M2.7 4.75l9.6 5.5M2.7 10.25l9.6-5.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (label.includes("구름") || label.includes("흐림")) {
    return (
      <svg viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path
          d="M4.3 11.2h6.2a2.4 2.4 0 0 0 .2-4.8 3.3 3.3 0 0 0-6.3.7 2.1 2.1 0 0 0-.1 4.1Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <SunIcon aria-hidden="true" />;
}

export type ToastTone = "success" | "error" | "info";
export type ToastState = { id: number; message: string; tone: ToastTone };

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      setToast({ id: Date.now(), message, tone });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 3600 : 2400,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      className={`toast toast--${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      key={toast.id}
    >
      {toast.tone === "error" ? (
        <ExclamationTriangleIcon aria-hidden="true" />
      ) : toast.tone === "info" ? (
        <InfoCircledIcon aria-hidden="true" />
      ) : (
        <CheckIcon aria-hidden="true" />
      )}
      <span>{toast.message}</span>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <main className="app state-app" aria-label="모임 불러오는 중">
      <div className="skeleton skeleton-hero" />
      <div className="state-content">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" />
        <span className="loading-label">모임을 불러오고 있어요</span>
      </div>
    </main>
  );
}

export function StateScreen({
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <main className="app state-app">
      <div className="state-content">
        <span className="state-icon">
          <ReloadIcon aria-hidden="true" />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <button className="home-primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button
            className="state-secondary"
            type="button"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        ) : null}
      </div>
    </main>
  );
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
