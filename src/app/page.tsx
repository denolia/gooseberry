import { isTabId } from "@/components/ui/mainTabs";
import { Header } from "@/components/ui/Header";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";
import { MainTabs } from "@/components/ui/MainTabs";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const tabParam = Array.isArray(resolvedSearchParams.tab)
    ? resolvedSearchParams.tab[0]
    : resolvedSearchParams.tab;
  const initialTab = isTabId(tabParam) ? tabParam : "translation";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <MainTabs initialTab={initialTab} />
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
