import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserProfile } from "@/db/profileRepo";
import { Header } from "@/components/ui/Header";
import { ProfileClient } from "@/components/profile/ProfileClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Learn.words" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const profile = await getUserProfile(session.user.id);
  if (!profile) redirect("/");

  return (
    <main className={styles.page}>
      <Header />
      <div className={styles.content}>
        <header className={styles.heading}>
          <p>LEARN.words / PROFILE</p>
          <h1>Your profile</h1>
          <span>Manage your account, plan, and learning defaults.</span>
        </header>
        <ProfileClient initialProfile={profile} />
      </div>
    </main>
  );
}
