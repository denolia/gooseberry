"use client";
import { useI18n } from "@/i18n/client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import styles from "./MainTabs.module.css";
import { tabs } from "@/components/ui/tabs";

export function MainTabs() {
  const { t } = useI18n();
  const { status } = useSession();
  const pathname = usePathname();

  if (status !== "authenticated") {
    return null;
  }

  return (
    <nav className={styles.tabList} aria-label={t("mainTabs.mainSections")}>
      {tabs.map((tab) => {
        const href =
          tab.id === "translation"
            ? "/"
            : tab.id === "analyzer"
              ? "/analyzer"
              : "/anki";
        const isActive = pathname === href;

        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            scroll={false}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
