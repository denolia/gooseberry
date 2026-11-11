import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ReviewSession } from "@/components/review/ReviewSession";
import { getUserReviewMode } from "@/db/profileRepo";
import { parseStudyQuery } from "@/lib/review/scope";
import styles from "@/styles/page.module.css";

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const part of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]) {
      search.append(key, part);
    }
  }
  let selection;
  try {
    selection = parseStudyQuery(search);
  } catch {
    return (
      <main className={styles.page}>
        <h1>Choose study sets</h1>
        <p>This study selection is invalid or empty.</p>
        <Link href="/anki">Back to sets</Link>
      </main>
    );
  }
  const reviewMode = await getUserReviewMode(session.user.id);
  return (
    <main className={styles.page}>
      <ReviewSession
        key={search.toString()}
        {...selection}
        reviewMode={reviewMode}
      />
    </main>
  );
}
