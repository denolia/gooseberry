import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <WordInputWithAuth />
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
