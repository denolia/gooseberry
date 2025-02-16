"use client";
import styles from "./Header.module.css";
import { signIn, signOut, useSession } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();

  return (
    <div className={styles.container}>
      <div className={styles.logo}>LEARN.words</div>
      <div>
        {session && (
          <>
            <button className={styles.signInButton} onClick={() => signOut()}>
              Sign out
            </button>
          </>
        )}

        {!session && (
          <button
            className={styles.signInButton}
            onClick={() => signIn("google")}
          >
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
