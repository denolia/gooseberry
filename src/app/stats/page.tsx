import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getI18n } from "@/i18n/server";
import { Header } from "@/components/ui/Header";
import { StudyActivityPanel } from "@/components/review/StudyActivityPanel";
import styles from "@/styles/accountPage.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: t("stats.pageTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function StatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { t } = await getI18n();

  return (
    <main className={styles.page}>
      <Header />
      <div className={styles.content}>
        <header className={styles.heading}>
          <p>{t("stats.learnWordsStats")}</p>
          <h1>{t("header.stats")}</h1>
          <span>{t("stats.description")}</span>
        </header>
        <StudyActivityPanel />
        <Link className={styles.backLink} href="/anki">
          {t("wordSetManager.backToSets")}
        </Link>
      </div>
    </main>
  );
}
