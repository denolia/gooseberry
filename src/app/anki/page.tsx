import { LandingPageShell } from "@/components/ui/LandingPageShell";
import { WordSetList } from "@/components/anki/WordSetList";

export default function AnkiPage() {
  return (
    <LandingPageShell activeTab="anki">
      <WordSetList />
    </LandingPageShell>
  );
}
