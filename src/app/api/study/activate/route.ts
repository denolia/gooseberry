import { activateStudyCard } from "@/lib/review/routes";

export async function POST(request: Request) {
  return activateStudyCard(request);
}
