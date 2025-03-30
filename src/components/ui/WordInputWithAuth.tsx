"use client";

import { useSession } from "next-auth/react";
import { WordInput } from "@/components/ui/WordInput";
import styles from "./WordInputWithAuth.module.css";

export function WordInputWithAuth() {
  const { data: session, status } = useSession();
  console.log("AuthenticatedWordInput: session", session, "status", status);
  // Don't show the sign-in message during loading
  if (status === "loading") {
    return <div className={styles.loadingState}></div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.authMessage}>
        <p>Please sign in</p>
      </div>
    );
  }

  return <WordInput />;
}
