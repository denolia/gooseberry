"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./MainTabs.module.css";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";
import { WordSetList } from "@/components/anki/WordSetList";

const tabs = [
  { id: "translation", label: "Translation" },
  { id: "anki", label: "Anki Sets" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return tabs.some((tab) => tab.id === value);
}

export function MainTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = isTabId(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "translation";

  function setActiveTab(tab: TabId) {
    const params = new URLSearchParams(searchParams.toString());

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
