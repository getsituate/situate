export const profiles = [
  {
    id: "mac",
    label: "macOS",
    mobile: false,
    width: 1040,
    height: 700,
    top: 0,
    bottom: 0,
    keyboard: 0,
  },
  {
    id: "windows",
    label: "Windows 11",
    mobile: false,
    width: 1040,
    height: 700,
    top: 0,
    bottom: 0,
    keyboard: 0,
  },
  {
    id: "kde",
    label: "Linux · KDE Plasma 6 / Breeze",
    mobile: false,
    width: 1040,
    height: 700,
    top: 0,
    bottom: 0,
    keyboard: 0,
  },
  {
    id: "ios",
    label: "iOS",
    mobile: true,
    width: 390,
    height: 844,
    top: 59,
    bottom: 34,
    keyboard: 260,
  },
  {
    id: "android",
    label: "Android",
    mobile: true,
    width: 412,
    height: 852,
    top: 32,
    bottom: 24,
    keyboard: 272,
  },
] as const;

export type PlatformId = (typeof profiles)[number]["id"];
export interface PlatformState {
  profile: PlatformId;
  keyboardOpen: boolean;
}
export interface ViewSize {
  width: number;
  height: number;
}

export function profileFor(id: PlatformId) {
  const profile = profiles.find((profile) => profile.id === id);
  if (!profile) throw new Error(`Unknown platform profile: ${id}`);
  return profile;
}

export function createPlatformState(
  profile: PlatformId = "mac",
): PlatformState {
  profileFor(profile);
  return { profile, keyboardOpen: false };
}

export function selectProfile(
  state: PlatformState,
  profile: PlatformId,
): PlatformState {
  return {
    profile,
    keyboardOpen: profileFor(profile).mobile && state.keyboardOpen,
  };
}

export function targetSize(state: PlatformState): ViewSize {
  const { width, height } = profileFor(state.profile);
  return { width, height };
}

export function contentEnvelope(
  state: PlatformState,
  size: ViewSize = targetSize(state),
) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width < 0 ||
    size.height < 0
  ) {
    throw new RangeError("Viewport dimensions must be finite and nonnegative.");
  }
  const profile = profileFor(state.profile);
  const top = Math.min(profile.top, size.height);
  const bottom = Math.min(profile.bottom, size.height - top);
  const keyboard = Math.min(
    state.keyboardOpen ? profile.keyboard : 0,
    size.height - top - bottom,
  );
  return {
    width: size.width,
    height: size.height - top - bottom - keyboard,
    top,
    bottom,
    keyboard,
  };
}
