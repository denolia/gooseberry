import { activateStudyCard } from "@/lib/review/routes";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return activateStudyCard(request, (await params).id);
}
