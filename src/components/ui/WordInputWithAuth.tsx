"use client";

import { signOut, useSession } from "next-auth/react";
import { WordInput } from "@/components/ui/WordInput";
import styles from "./WordInputWithAuth.module.css";

export function WordInputWithAuth() {
  const { data: session, status } = useSession();

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

  if (!session?.user?.id) {
    return (
      <div className={styles.authMessage}>
        <p>Your session could not be initialized.</p>
        <button className={styles.authAction} onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return <WordInput />;
}
