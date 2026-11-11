import StudyPage from "@/app/study/page";

// Preserve bookmarked single-set URLs while using the common study page.
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id } = await params;
  const { filter } = await searchParams;
  return StudyPage({
    searchParams: Promise.resolve({ scope: "sets", set: id, filter }),
  });
}
