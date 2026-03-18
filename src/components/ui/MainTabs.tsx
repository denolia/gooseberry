"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import styles from "./MainTabs.module.css";
import { tabs } from "@/components/ui/mainTabs";

export function MainTabs() {
  const { status } = useSession();
  const pathname = usePathname();

  if (status !== "authenticated") {
    return null;
  }

  return (
    <nav className={styles.tabList} aria-label="Main sections">
      {tabs.map((tab) => {
        const href = tab.id === "translation" ? "/" : "/anki";
        const isActive = pathname === href;

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
