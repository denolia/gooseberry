import { LandingPageShell } from "@/components/ui/LandingPageShell";
import { WordInputWithAuth } from "@/components/ui/WordInputWithAuth";

export default function Home() {
  return (
    <LandingPageShell activeTab="translation">
      <WordInputWithAuth />
    </LandingPageShell>
  );
}
