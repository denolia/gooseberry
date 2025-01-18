import Image from "next/image";
import styles from "@/styles/page.module.css";

export function HomeHero() {
  return (
    <>
      <Image
        className={styles.logo}
        src="/Learn_words_logo.png"
        alt="App logo"
        width={180}
        height={38}
        priority
      />
    </>
  );
} 