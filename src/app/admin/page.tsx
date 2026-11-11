import { getI18n } from "@/i18n/server";
import Link from "next/link";
import { getAdminUsers } from "@/db/adminRepo";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import styles from "./page.module.css";
import { getPendingPremiumRequests } from "@/db/premiumRepo";
import { resolvePremiumRequestAction } from "./actions";
import { PremiumTierControl } from "@/components/admin/PremiumTierControl";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: t("admin.pageTitle"),
    robots: { index: false, follow: false },
  };
}
const number = (value: number) => value.toLocaleString("en-US");
const date = (value: string | Date | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" })
    : "—";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { t } = await getI18n();
  await requireAdmin();
  const params = await searchParams;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const requestedPage = Number(params.page);
  const [{ users, total, page }, premiumRequests] = await Promise.all([
    getAdminUsers(
      query,
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
    ),
    getPendingPremiumRequests(),
  ]);
  const pages = Math.max(1, Math.ceil(total / 25));
  const pageLink = (value: number) =>
    `/admin?${new URLSearchParams({ q: query, page: String(value) })}`;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("admin.learnWordsAdmin")}</p>
          <h1>{t("admin.userOverview")}</h1>
          <p>{t("admin.accountsLearningActivityAndRecordedAiUsage")}</p>
        </div>
        <Link href="/">{t("admin.backToLearning")}</Link>
      </header>
      <section className={styles.requests} aria-labelledby="premium-requests">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>{t("admin.access")}</p>
            <h2 id="premium-requests">{t("admin.premiumRequests")}</h2>
          </div>
          <strong>
            {t("admin.pendingCount", { count: number(premiumRequests.length) })}
          </strong>
        </div>
        {premiumRequests.length ? (
          <div className={styles.requestList}>
            {premiumRequests.map((request) => (
              <article key={request.id} className={styles.requestCard}>
                <div>
                  <strong>{request.name || t("admin.unnamedUser")}</strong>
                  <span>{request.email || t("admin.noEmail")}</span>
                  <small>
                    {t("admin.requested")} {date(request.createdAt)}
                  </small>
                  {request.message && <p>“{request.message}”</p>}
                </div>
                <form action={resolvePremiumRequestAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button name="decision" value="declined" type="submit">
                    {t("admin.decline")}
                  </button>
                  <button
                    className={styles.approveButton}
                    name="decision"
                    value="approved"
                    type="submit"
                  >
                    {t("admin.approvePremium")}
                  </button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.noRequests}>
            {t("admin.noPremiumRequestsAreWaiting")}
          </p>
        )}
      </section>
      <form className={styles.search} action="/admin">
        <label htmlFor="user-search">{t("admin.searchUsers")}</label>
        <div>
          <input
            id="user-search"
            name="q"
            type="search"
            placeholder={t("admin.nameEmailOrUserId")}
            defaultValue={query}
            maxLength={200}
          />
          <button type="submit">{t("admin.search")}</button>
          {query && <Link href="/admin">{t("admin.clear")}</Link>}
        </div>
      </form>
      <p className={styles.count}>
        <strong>{number(total)}</strong>{" "}
        {query ? t("admin.matchingAccounts") : t("admin.registeredAccounts")}{" "}
        {t("admin.page")} {page} {t("importDeck.of")} {pages}
      </p>
      <div className={styles.tableWrap}>
        <table>
          <caption className={styles.caption}>
            {t("admin.allDatesAreUtcExpandAUserSUsageDetails")}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.user")}</th>
              <th scope="col">{t("profileClient.plan")}</th>
              <th scope="col">{t("admin.accountActivity")}</th>
              <th scope="col">{t("admin.savedTranslations")}</th>
              <th scope="col">Anki</th>
              <th scope="col">{t("admin.aiUsageSinceTrackingBegan")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name || t("admin.unnamedUser")}</strong>
                  <span>{user.email || t("admin.noEmail")}</span>
                  <small>{user.id}</small>
                </td>
                <td>
                  <PremiumTierControl userId={user.id} tier={user.tier} />
                </td>
                <td>
                  <span>
                    {t("admin.joined")} {date(user.created_at)}
                  </span>
                  <span>
                    {t("admin.lastLogin")} {date(user.last_login_at)}
                  </span>
                  <span>
                    {t("admin.lastTranslation")} {date(user.last_translation)}
                  </span>
                </td>
                <td>
                  <strong>
                    {number(user.translations)} {t("admin.wordsPhrases")}
                  </strong>
                  <span>
                    {number(user.unique_entries)} {t("admin.uniqueEntries")}
                  </span>
                </td>
                <td>
                  <strong>
                    {number(user.sets)} {t("admin.sets")} {number(user.notes)}{" "}
                    {t("importDeck.notes")}
                  </strong>
                  <span>
                    {number(user.exported_sets)}{" "}
                    {t("admin.setsExportedAtLeastOnce")}
                  </span>
                </td>
                <td>
                  <strong>
                    {number(user.translate_calls)} {t("admin.translations")}{" "}
                    {number(user.analyze_calls)} {t("admin.analyses")}{" "}
                    {number(user.enrich_calls)} {t("admin.enrichments")}
                  </strong>
                  <span>
                    {number(user.month_calls)} {t("admin.requestsThisMonthUtc")}
                  </span>
                  <span>
                    {number(user.input_tokens + user.output_tokens)}{" "}
                    {t("admin.knownTokens")}
                  </span>
                  <details>
                    <summary>{t("admin.usageDetails")}</summary>
                    <span>
                      {number(user.successful_calls)} {t("admin.successful")}{" "}
                      {number(user.failed_calls)} {t("admin.failed")}{" "}
                      {number(user.pending_calls)}{" "}
                      {t("admin.pendingUnresolved")}
                    </span>
                    <span>
                      {number(user.input_words)}{" "}
                      {t("admin.submittedWordsIncludingRepeats")}
                    </span>
                    <span>
                      {number(user.input_tokens)} {t("admin.inputTokens")}
                      {number(user.cached_tokens)} {t("admin.cached")}
                    </span>
                    <span>
                      {number(user.output_tokens)}{" "}
                      {t("admin.outputTokensIncludesReasoning")}
                    </span>
                    <span>
                      {number(user.unknown_usage)}{" "}
                      {t("admin.requestsWithUnknownTokenUsage")}
                    </span>
                    <span>
                      {t("admin.firstTrackedRequest")}{" "}
                      {date(user.first_tracked)}
                    </span>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && (
          <p className={styles.empty}>{t("admin.noAccountsFound")}</p>
        )}
      </div>
      <nav className={styles.pagination} aria-label={t("admin.userPages")}>
        {page > 1 && (
          <Link href={pageLink(page - 1)}>{t("admin.previous")}</Link>
        )}
        {page < pages && (
          <Link href={pageLink(page + 1)}>{t("admin.next")}</Link>
        )}
      </nav>
      <aside className={styles.note}>
        <strong>{t("admin.howToReadTheseNumbers")}</strong>
        <p>
          {t("admin.eachSavedTranslationIsOneWordOrPhraseIncludingRepeats")}
        </p>
        <p>
          {t("admin.aiTrackingStartsWithThisReleaseAndIncludesTranslationAnd")}
        </p>
      </aside>
    </main>
  );
}
