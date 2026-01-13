import { Header } from "@/components/ui/Header";
import { AppFooter } from "@/components/layout/AppFooter";
import { WordSetManager } from "@/components/anki/WordSetManager";
import styles from "@/styles/page.module.css";

export default function WordSetPage({ params }: { params: { id: string } }) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <WordSetManager wordSetId={params.id} />
      </main>
      <AppFooter />
    </div>
  );
}
