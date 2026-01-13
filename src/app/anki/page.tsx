import { Header } from "@/components/ui/Header";
import { AppFooter } from "@/components/layout/AppFooter";
import { WordSetList } from "@/components/anki/WordSetList";
import styles from "@/styles/page.module.css";

export default function AnkiPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <div style={{ width: "100%", maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ marginBottom: "2rem" }}>Anki Word Sets</h1>
          <WordSetList />
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
