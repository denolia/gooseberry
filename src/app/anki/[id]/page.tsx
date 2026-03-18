import { Header } from "@/components/ui/Header";
import { WordSetManager } from "@/components/anki/WordSetManager";
import styles from "@/styles/page.module.css";

export default async function WordSetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <WordSetManager wordSetId={id} />
      </main>
    </div>
  );
}
