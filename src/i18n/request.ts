import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { auth } from "@/auth";
import { getOrInitializeUserLocale } from "@/db/profileRepo";
import { detectUiLocale } from "./locale";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

export default getRequestConfig(async () => {
  const session = await auth();
  const detected = detectUiLocale((await headers()).get("accept-language"));
  // Settings are authoritative even when an authentication session is older.
  const locale = session?.user?.id
    ? await getOrInitializeUserLocale(session.user.id, detected)
    : detected;
  // English is also the per-message fallback while a catalog is being extended.
  const messages =
    locale === "ru"
      ? Object.fromEntries(
          Object.entries(en).map(([namespace, values]) => [
            namespace,
            { ...values, ...ru[namespace as keyof typeof ru] },
          ]),
        )
      : en;
  return { locale, messages };
});
