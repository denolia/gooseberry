"use client";
import { useI18n } from "@/i18n/client";

import { signOut, useSession } from "next-auth/react";
import { WordInput } from "@/components/ui/WordInput";
import styles from "./WordInputWithAuth.module.css";

export function WordInputWithAuth() {
  const { t } = useI18n();
  const { data: session, status } = useSession();

  // Don't show the sign-in message during loading
  if (status === "loading") {
    return <div className={styles.loadingState}></div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.authMessage}>
        <p>{t("wordInputWithAuth.pleaseSignIn")}</p>
      </div>
    );
  }

  if (!session?.user?.id) {
    return (
      <div className={styles.authMessage}>
        <p>{t("wordInputWithAuth.yourSessionCouldNotBeInitialized")}</p>
        <button className={styles.authAction} onClick={() => signOut()}>
          {t("header.signOut")}
        </button>
      </div>
    );
  }

  return <WordInput />;
}
