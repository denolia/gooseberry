import { undoStudyReview } from "@/lib/review/routes";

export async function POST(request: Request) {
  return undoStudyReview(request);
}
