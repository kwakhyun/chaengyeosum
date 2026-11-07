import {
  Analytics,
  getTossShareLink,
  share,
} from "@apps-in-toss/web-framework";

export const APP_NAME = "chaengyeosum";
export const SHARE_OG_IMAGE_URL =
  "https://chaengyeosum-mobile.khyun97.chatgpt.site/og.png";

export function hasTossBridge() {
  return (
    typeof (
      window as Window & {
        ReactNativeWebView?: { postMessage?: unknown };
      }
    ).ReactNativeWebView?.postMessage === "function"
  );
}

export function track(
  name: string,
  params: Record<string, string | number> = {},
) {
  if (!hasTossBridge()) return;
  try {
    void Analytics.click({ log_name: name, ...params });
  } catch {
    // 분석 실패가 핵심 흐름을 막지 않게 해요.
  }
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

function isShareCancel(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

export async function copyText(text: string) {
  try {
    if (window.navigator.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 대체 방식으로 다시 시도해요.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * 토스 앱에서는 토스 공유, 모바일 웹에서는 시스템 공유 시트,
 * 그 외에는 클립보드 복사를 사용해요. 사용자가 공유를 취소하면
 * 복사로 넘어가지 않고 "cancelled"를 돌려줘요.
 */
export async function shareContent({
  title,
  message,
  deepLink,
  webLink,
  files,
}: {
  title: string;
  message: string;
  deepLink: string;
  webLink: string;
  files?: File[];
}): Promise<ShareOutcome> {
  const fallbackText = `${message}\n\n${webLink}`;

  if (hasTossBridge()) {
    try {
      const tossLink = await getTossShareLink(deepLink, SHARE_OG_IMAGE_URL);
      await share({ message: `${message}\n\n${tossLink}` });
      return "shared";
    } catch (error) {
      if (isShareCancel(error)) return "cancelled";
      return (await copyText(fallbackText)) ? "copied" : "failed";
    }
  }

  if (typeof window.navigator.share === "function") {
    try {
      const canShareFiles =
        files &&
        files.length > 0 &&
        typeof window.navigator.canShare === "function" &&
        window.navigator.canShare({ files });
      await window.navigator.share({
        title,
        text: message,
        url: webLink,
        ...(canShareFiles ? { files } : {}),
      });
      return "shared";
    } catch (error) {
      if (isShareCancel(error)) return "cancelled";
    }
  }

  return (await copyText(fallbackText)) ? "copied" : "failed";
}
