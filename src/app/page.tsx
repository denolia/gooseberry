import Image from "next/image";
import { HomeHero } from "@/components/ui/HomeHero";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <HomeHero />
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
