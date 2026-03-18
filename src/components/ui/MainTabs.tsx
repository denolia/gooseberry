"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./MainTabs.module.css";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";
import { WordSetList } from "@/components/anki/WordSetList";
import { isTabId, TabId, tabs } from "@/components/ui/mainTabs";

export function MainTabs({ initialTab }: { initialTab: TabId }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTabState] = useState<TabId>(initialTab);

  useEffect(() => {
    setActiveTabState(initialTab);
  }, [initialTab]);

  useEffect(() => {
    function syncTabFromUrl() {
      const tab = new URLSearchParams(window.location.search).get("tab");
      setActiveTabState(isTabId(tab) ? tab : "translation");
    }

    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  function setActiveTab(tab: TabId) {
    setActiveTabState(tab);
    const params = new URLSearchParams(window.location.search);

    if (tab === "translation") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section className={styles.shell}>
      <div className={styles.tabList} role="tablist" aria-label="Main sections">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={styles.panel}>
        {activeTab === "translation" ? <WordInputWithAuth /> : <WordSetList />}
      </div>
    </section>
  );
}
