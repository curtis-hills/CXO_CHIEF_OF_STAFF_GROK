"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { clearLiveInputsCache } from "@/lib/data/live-cache";
import { clearOverride, writeOverride } from "@/lib/data/overrides";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REASONS = new Set(["", "intake", "credentials", "coi", "other"]);

function dateOrNull(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!DAY.test(raw)) {
    throw new Error("Dates use YYYY-MM-DD.");
  }
  return `${raw}T15:00:00.000Z`;
}

export async function saveLifecycleOverride(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  if (!ID.test(orgId)) {
    throw new Error("Unknown account.");
  }

  try {
    if (formData.get("clear") === "on") {
      clearOverride(orgId);
    } else {
      const reason = String(formData.get("waitingReason") ?? "");
      if (!REASONS.has(reason)) {
        throw new Error("Unknown waiting reason.");
      }
      writeOverride(orgId, {
        onboardingAt: dateOrNull(formData.get("onboardingAt")),
        readyToLaunchAt: dateOrNull(formData.get("readyToLaunchAt")),
        launchedAt: dateOrNull(formData.get("launchedAt")),
        waitingOnCustomer: formData.get("waitingOnCustomer") === "on",
        waitingReason: reason || null,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Dates")) throw error;
    if (error instanceof Error && error.message.startsWith("Unknown")) throw error;
    throw new Error("Could not store the override. This environment may be read-only until Postgres is connected.");
  }

  clearLiveInputsCache();
  revalidateTag("cxm-portfolio");
  revalidatePath("/");
  revalidatePath("/pre-launch");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${orgId}`);
  revalidatePath("/health");
  revalidatePath("/actions");
  redirect(`/accounts/${orgId}?saved=1`);
}
