"use server";

import { revalidatePath } from "next/cache";
import { resolvePremiumRequest } from "@/db/premiumRepo";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolvePremiumRequestAction(formData: FormData) {
  const requestId = formData.get("requestId");
  const decision = formData.get("decision");
  if (
    typeof requestId !== "string" ||
    !UUID_PATTERN.test(requestId) ||
    (decision !== "approved" && decision !== "declined")
  ) {
    return;
  }

  await resolvePremiumRequest(requestId, decision);
  revalidatePath("/admin");
}
