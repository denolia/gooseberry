"use client";

import { useSession } from "next-auth/react";
import { SignedOutLanding } from "@/components/ui/SignedOutLanding";
import landingStyles from "@/components/ui/SignedOutLanding.module.css";
import { Header } from "@/components/ui/Header";
import { MainTabs } from "@/components/ui/MainTabs";
import { LandingPanels } from "@/components/ui/LandingPanels";
import styles from "@/styles/page.module.css";
import tabsStyles from "@/components/ui/MainTabs.module.css";

export default function LandingLayout() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <main
        className={landingStyles.loading}
        aria-label="Loading Learn.words"
        aria-busy="true"
      >
        <span className={landingStyles.logo}>LEARN.words</span>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return <SignedOutLanding />;
  }

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
