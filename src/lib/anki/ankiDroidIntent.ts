const ANKIDROID_PACKAGE = "com.ichi2.anki";

export function createAnkiDroidIntentUrl(downloadUrl: string): string {
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AnkiDroid downloads require an HTTP or HTTPS URL");
  }

  const scheme = url.protocol.slice(0, -1);
  const fallbackUrl = encodeURIComponent(url.toString());

  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    "#Intent;" +
    `scheme=${scheme};` +
    `package=${ANKIDROID_PACKAGE};` +
    "action=android.intent.action.VIEW;" +
    "category=android.intent.category.BROWSABLE;" +
    `S.browser_fallback_url=${fallbackUrl};` +
    "end"
  );
}
