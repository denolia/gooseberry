import en from "../../messages/en.json";
import type { UiLocale } from "@/i18n/locale";

declare module "next-intl" {
  interface AppConfig {
    Locale: UiLocale;
    Messages: typeof en;
  }
}
