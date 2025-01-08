import Image from "next/image";
import { HomeHero } from "@/components/ui/HomeHero";
import { CTASection } from "@/components/ui/CTASection";
import { AppFooter } from "@/components/layout/AppFooter";
import styles from "@/styles/page.module.css";
import { WordInput } from "@/components/ui/WordInput";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <HomeHero />
        <WordInput />
        <CTASection />
      </main>
      <AppFooter />
    </div>
  );
}
