import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Header } from "@/components/ui/Header";
import { ImportDeck } from "@/components/anki/ImportDeck";
import styles from "@/styles/page.module.css";

export default async function ImportDeckPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Header />
        <ImportDeck />
      </main>
    </div>
  );
}
