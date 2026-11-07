import {
  isSummerTypeKey,
  SUMMER_TYPE_RESULTS,
} from "./components/SummerTypeTest";

const BASIC_AVATARS = new Set(["me", "minji", "junho", "seoyeon"]);

export function avatarSrc(avatarKey: string) {
  if (avatarKey.startsWith("type-")) {
    const typeKey = avatarKey.slice("type-".length);
    if (isSummerTypeKey(typeKey)) return SUMMER_TYPE_RESULTS[typeKey].image;
  }
  const safeKey = BASIC_AVATARS.has(avatarKey) ? avatarKey : "me";
  return `/assets/avatar-${safeKey}.png`;
}

export function isTypeAvatar(avatarKey: string) {
  return avatarKey.startsWith("type-");
}

export function summerTypeAvatarKey(typeKey: string | null) {
  return typeKey && isSummerTypeKey(typeKey) ? `type-${typeKey}` : undefined;
}
