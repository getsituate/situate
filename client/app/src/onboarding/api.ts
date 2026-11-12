import { invoke } from "@tauri-apps/api/core";
import { isOnboardingSnapshot, type OnboardingRecord } from "./types";

export async function loadOnboarding(scope: string) {
  const value: unknown = await invoke("onboarding_load", { scope });
  if (!isOnboardingSnapshot(value))
    throw new Error("native.onboarding.storage.invalid");
  return value;
}

export async function saveOnboarding(
  scope: string,
  record: OnboardingRecord,
  expectedRevision: string | null,
) {
  const value: unknown = await invoke("onboarding_save", {
    scope,
    record,
    expectedRevision,
  });
  if (!isOnboardingSnapshot(value))
    throw new Error("native.onboarding.storage.invalid");
  return value;
}
