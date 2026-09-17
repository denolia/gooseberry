"use client";

import { useFormStatus } from "react-dom";
import { setUserPremiumTierAction } from "@/app/admin/actions";
import styles from "@/app/admin/page.module.css";

function SubmitButton({ tier }: { tier: "free" | "premium" }) {
  const { pending } = useFormStatus();
  const granting = tier === "free";
  return (
    <button
      className={granting ? styles.grantButton : styles.revokeButton}
      type="submit"
      disabled={pending}
    >
      {pending ? "Saving…" : granting ? "Grant Premium" : "Revoke Premium"}
    </button>
  );
}

export function PremiumTierControl({
  userId,
  tier,
}: {
  userId: string;
  tier: "free" | "premium";
}) {
  return (
    <form
      className={styles.tierControl}
      action={setUserPremiumTierAction}
      onSubmit={(event) => {
        if (
          tier === "premium" &&
          !window.confirm(
            "Revoke Premium access for this user? They will immediately lose access to Premium features.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input
        type="hidden"
        name="tier"
        value={tier === "premium" ? "free" : "premium"}
      />
      <span
        className={`${styles.tierBadge} ${tier === "premium" ? styles.tierPremium : styles.tierFree}`}
      >
        {tier === "premium" ? "Premium" : "Free"}
      </span>
      <SubmitButton tier={tier} />
    </form>
  );
}
