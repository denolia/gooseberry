import { Header } from "@/components/ui/Header";
import { MainTabs } from "@/components/ui/MainTabs";
import { LandingPanels } from "@/components/ui/LandingPanels";
import styles from "@/styles/page.module.css";
import tabsStyles from "@/components/ui/MainTabs.module.css";

export default function LandingLayout() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <section className={tabsStyles.shell}>
          <MainTabs />
          <div className={tabsStyles.panel}>
            <LandingPanels />
          </div>
        </section>
      </main>
    </div>
  );
}
