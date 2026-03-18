import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";
import { MainTabs } from "@/components/ui/MainTabs";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <MainTabs />
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
