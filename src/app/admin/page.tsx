import Link from "next/link";
import { getAdminUsers } from "@/db/adminRepo";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin · Learn.words",
  robots: { index: false, follow: false },
};
const number = (value: number) => value.toLocaleString("en-US");
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" })
    : "—";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const requestedPage = Number(params.page);
  const { users, total, page } = await getAdminUsers(
    query,
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1,
  );
  const pages = Math.max(1, Math.ceil(total / 25));
  const pageLink = (value: number) =>
    `/admin?${new URLSearchParams({ q: query, page: String(value) })}`;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>LEARN.words / ADMIN</p>
          <h1>User overview</h1>
          <p>Accounts, learning activity, and recorded AI usage.</p>
        </div>
        <Link href="/">Back to learning</Link>
      </header>
      <form className={styles.search} action="/admin">
        <label htmlFor="user-search">Search users</label>
        <div>
          <input
            id="user-search"
            name="q"
            type="search"
            placeholder="Name, email, or user ID"
            defaultValue={query}
            maxLength={200}
          />
          <button type="submit">Search</button>
          {query && <Link href="/admin">Clear</Link>}
        </div>
      </form>
      <p className={styles.count}>
        <strong>{number(total)}</strong>{" "}
        {query ? "matching accounts" : "registered accounts"} · Page {page} of{" "}
        {pages}
      </p>
      <div className={styles.tableWrap}>
        <table>
          <caption className={styles.caption}>
            All dates are UTC. Expand a user’s usage details for token
            breakdowns.
          </caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Account activity</th>
              <th scope="col">Saved translations</th>
              <th scope="col">Anki</th>
              <th scope="col">AI usage since tracking began</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name || "Unnamed user"}</strong>
                  <span>{user.email || "No email"}</span>
                  <small>{user.id}</small>
                </td>
                <td>
                  <span>Joined {date(user.created_at)}</span>
                  <span>Last login {date(user.last_login_at)}</span>
                  <span>Last translation {date(user.last_translation)}</span>
                </td>
                <td>
                  <strong>{number(user.translations)} words / phrases</strong>
                  <span>{number(user.unique_entries)} unique entries</span>
                </td>
                <td>
                  <strong>
                    {number(user.sets)} sets · {number(user.cards)} cards
                  </strong>
                  <span>{number(user.enabled_cards)} enabled cards</span>
                  <span>
                    {number(user.exported_sets)} sets exported at least once
                  </span>
                </td>
                <td>
                  <strong>
                    {number(user.translate_calls)} translations ·{" "}
                    {number(user.analyze_calls)} analyses
                  </strong>
                  <span>
                    {number(user.month_calls)} requests this month (UTC)
                  </span>
                  <span>
                    {number(user.input_tokens + user.output_tokens)} known
                    tokens
                  </span>
                  <details>
                    <summary>Usage details</summary>
                    <span>
                      {number(user.successful_calls)} successful ·{" "}
                      {number(user.failed_calls)} failed ·{" "}
                      {number(user.pending_calls)} pending / unresolved
                    </span>
                    <span>
                      {number(user.input_words)} submitted words (including
                      repeats)
                    </span>
                    <span>
                      {number(user.input_tokens)} input tokens (
                      {number(user.cached_tokens)} cached)
                    </span>
                    <span>
                      {number(user.output_tokens)} output tokens (includes
                      reasoning)
                    </span>
                    <span>
                      {number(user.unknown_usage)} requests with unknown token
                      usage
                    </span>
                    <span>
                      First tracked request {date(user.first_tracked)}
                    </span>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && <p className={styles.empty}>No accounts found.</p>}
      </div>
      <nav className={styles.pagination} aria-label="User pages">
        {page > 1 && <Link href={pageLink(page - 1)}>← Previous</Link>}
        {page < pages && <Link href={pageLink(page + 1)}>Next →</Link>}
      </nav>
      <aside className={styles.note}>
        <strong>How to read these numbers</strong>
        <p>
          Each saved translation is one word or phrase, including repeats.
          Unique entries distinguish language pairs. Anki counts describe
          currently saved sets and cards, not deleted items or total exports.
        </p>
        <p>
          AI tracking starts with this release and includes translation and text
          analysis requests. Old token usage is unavailable. Missing usage after
          interrupted or failed calls is unknown, not zero; known tokens may
          undercount actual spend. Pending records may be in progress or need
          reconciliation. No quota limits are enforced yet.
        </p>
      </aside>
    </main>
  );
}
