import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Header } from "@/components/ui/Header";
import { ReviewSession } from "@/components/review/ReviewSession";
import { getUserReviewMode } from "@/db/profileRepo";
import styles from "@/styles/page.module.css";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const { id } = await params;
  const reviewMode = await getUserReviewMode(session.user.id);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <ReviewSession wordSetId={id} reviewMode={reviewMode} />
      </main>
    </div>
  );
}
