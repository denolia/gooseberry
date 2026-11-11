import { getStudyQueue } from "@/lib/review/routes";

export async function GET(request: Request) {
  return getStudyQueue(request);
}
