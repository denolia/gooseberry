import Image from "next/image";
import styles from "@/styles/page.module.css";

export function HomeHero() {
  return (
    <>
      <Image
        className={styles.logo}
        src="/next.svg"
        alt="Next.js logo"
        width={180}
        height={38}
        priority
      />
      <ol>
        <li>
          Get started by editing <code>src/app/page.tsx</code>
        </li>
        <li>ddddSave and see your changes instantly.</li>
      </ol>
    </>
  );
} 