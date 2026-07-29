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

export async function initializeAnonymousUser() {
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
