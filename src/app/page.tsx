import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";
import { MainTabs } from "@/components/ui/MainTabs";
import { Suspense } from "react";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <Suspense fallback={null}>
          <MainTabs />
        </Suspense>

        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
