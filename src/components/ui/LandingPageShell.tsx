import { ReactNode } from "react";
import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import { MainTabs } from "@/components/ui/MainTabs";
import { TabId } from "@/components/ui/mainTabs";
import styles from "@/styles/page.module.css";
import tabsStyles from "@/components/ui/MainTabs.module.css";

export function LandingPageShell({
  activeTab,
  children,
}: {
  activeTab: TabId;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <section className={tabsStyles.shell}>
          <MainTabs activeTab={activeTab} />
          <div className={tabsStyles.panel}>{children}</div>
        </section>
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
