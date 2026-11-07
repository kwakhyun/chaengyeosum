import { getAnonymousKey } from "@apps-in-toss/web-framework";

let activeAnonymousUserKey = "";
const IDENTITY_STORAGE_KEY = "chaengyeosum.anonymous-user.v1";

export function getActiveAnonymousUserKey() {
  return activeAnonymousUserKey;
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type AnonymousUser = { key: string; canLinkLocalSessions: boolean };

let identityPromise: Promise<AnonymousUser | null> | null = null;

/** 앱 실행마다 한 번만 토스 익명 키를 받아요. 여러 화면이 같은 결과를 기다려요. */
export function initializeAnonymousUser() {
  identityPromise ??= resolveAnonymousUser();
  return identityPromise;
}

/**
 * 참여 토큰이 없는 세션은 익명 키가 유일한 인증 수단이라, 첫 조회 전에 키를 기다려요.
 * 브릿지가 응답하지 않는 환경에서도 화면이 멈추지 않도록 잠깐만 기다려요.
 */
export function waitForAnonymousUser(timeoutMs = 2500) {
  let timer = 0;
  return Promise.race([
    initializeAnonymousUser(),
    new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

async function resolveAnonymousUser(): Promise<AnonymousUser | null> {
  try {
    const result = await getAnonymousKey();
    if (
      result &&
      typeof result === "object" &&
      result.type === "HASH" &&
      typeof result.hash === "string" &&
      result.hash.length > 0
    ) {
      activeAnonymousUserKey = result.hash;
      const nextFingerprint = await fingerprint(result.hash);
      const previousFingerprint = window.localStorage.getItem(
        IDENTITY_STORAGE_KEY,
      );
      window.localStorage.setItem(IDENTITY_STORAGE_KEY, nextFingerprint);
      return {
        key: result.hash,
        canLinkLocalSessions:
          previousFingerprint === null ||
          previousFingerprint === nextFingerprint,
      };
    }
  } catch {
    // 일반 브라우저와 미지원 토스 앱에서는 기존 로컬 세션을 사용해요.
  }
  return null;
}
