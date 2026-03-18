import Link from "next/link";
import styles from "./MainTabs.module.css";
import { TabId, tabs } from "@/components/ui/mainTabs";

export function MainTabs({ activeTab }: { activeTab: TabId }) {
  return (
    <nav className={styles.tabList} aria-label="Main sections">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const href = tab.id === "translation" ? "/" : "/anki";

        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            scroll={false}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
