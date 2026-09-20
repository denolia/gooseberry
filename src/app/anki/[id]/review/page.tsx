import { Header } from "@/components/ui/Header";
import { ReviewSession } from "@/components/review/ReviewSession";
import styles from "@/styles/page.module.css";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <ReviewSession wordSetId={id} />
      </main>
    </div>
  );
}
