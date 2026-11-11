import { submitStudyReview } from "@/lib/review/routes";

export async function POST(request: Request) {
  return submitStudyReview(request);
}
