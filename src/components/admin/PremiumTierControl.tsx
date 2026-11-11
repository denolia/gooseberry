"use client";
import { useI18n } from "@/i18n/client";

import { useFormStatus } from "react-dom";
import { setUserPremiumTierAction } from "@/app/admin/actions";
import styles from "@/app/admin/page.module.css";

function SubmitButton({ tier }: { tier: "free" | "premium" }) {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  const granting = tier === "free";
  return (
    <button
      className={granting ? styles.grantButton : styles.revokeButton}
      type="submit"
      disabled={pending}
    >
      {pending
        ? t("premiumTierControl.saving")
        : granting
          ? t("premiumTierControl.grantPremium")
          : t("premiumTierControl.revokePremium")}
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
  const { t } = useI18n();
  return (
    <form
      className={styles.tierControl}
      action={setUserPremiumTierAction}
      onSubmit={(event) => {
        if (
          tier === "premium" &&
          !window.confirm(
            t(
              "premiumTierControl.revokePremiumAccessForThisUserTheyWillImmediatelyLoseAccess",
            ),
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
        {tier === "premium"
          ? t("premiumTierControl.premium")
          : t("premiumTierControl.free")}
      </span>
      <SubmitButton tier={tier} />
    </form>
  );
}
