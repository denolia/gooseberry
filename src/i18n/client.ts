"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Translate } from "./messages";

export function useI18n() {
  const t: Translate = useTranslations();
  const locale = useLocale();
  return { t, locale };
}
