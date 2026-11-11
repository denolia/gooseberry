import { getI18n } from "@/i18n/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserProfile } from "@/db/profileRepo";
import { Header } from "@/components/ui/Header";
import { ProfileClient } from "@/components/profile/ProfileClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("profile.pageTitle") };
}

export default async function ProfilePage() {
  const { t } = await getI18n();
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const profile = await getUserProfile(session.user.id);
  if (!profile) redirect("/");

  return (
    <main className={styles.page}>
      <Header />
      <div className={styles.content}>
        <header className={styles.heading}>
          <p>{t("profile.learnWordsProfile")}</p>
          <h1>{t("profile.yourProfile")}</h1>
          <span>{t("profile.manageYourAccountPlanAndLearningDefaults")}</span>
        </header>
        <ProfileClient initialProfile={profile} />
      </div>
    </main>
  );
}
