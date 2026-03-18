import { ReactNode } from "react";
import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import { MainTabs } from "@/components/ui/MainTabs";
import styles from "@/styles/page.module.css";
import tabsStyles from "@/components/ui/MainTabs.module.css";

export default function LandingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <section className={tabsStyles.shell}>
          <MainTabs />
          <div className={tabsStyles.panel}>{children}</div>
        </section>
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
