import { getConsentedUserData } from "@apps-in-toss/web-framework";

const CONSENTED_USER_DATA_KEY =
  import.meta.env.VITE_TOSS_USER_DATA_KEY?.trim() ?? "";

let activeDisplayName = "";
let pendingDisplayName: Promise<string | null> | null = null;

export function normalizeUserDisplayName(value: unknown, maxLength = 12) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function getSharedDisplayName(search: string) {
  return normalizeUserDisplayName(
    new URLSearchParams(search).get("summerName"),
  );
}

export async function getTossUserDisplayName() {
  if (activeDisplayName) return activeDisplayName;
  if (!CONSENTED_USER_DATA_KEY.startsWith("cud_")) return null;
  if (pendingDisplayName) return pendingDisplayName;

  pendingDisplayName = (async () => {
    try {
      const data = await getConsentedUserData({
        consentedUserDataKey: CONSENTED_USER_DATA_KEY,
      });
      const displayName = normalizeUserDisplayName(data?.USER_NAME, 10);
      if (!displayName) return null;
      activeDisplayName = displayName;
      return displayName;
    } catch {
      // 일반 브라우저, 미지원 토스 앱, 동의 취소 시 직접 입력을 유지해요.
      return null;
    } finally {
      pendingDisplayName = null;
    }
  })();

  return pendingDisplayName;
}
