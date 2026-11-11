import { getStudyQueue, submitStudyReview } from "@/lib/review/routes";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return getStudyQueue(request, (await params).id);
}
export async function POST(request: Request, { params }: Context) {
  return submitStudyReview(request, (await params).id);
}
