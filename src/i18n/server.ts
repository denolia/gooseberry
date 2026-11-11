import { getTranslations } from "next-intl/server";
import type { Translate } from "./messages";

export async function getI18n() {
  const t: Translate = await getTranslations();
  return { t };
}
