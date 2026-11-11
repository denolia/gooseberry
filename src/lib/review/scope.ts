import { z } from "zod";

export const MAX_STUDY_SETS = 100;
const SetIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export const StudyScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z
    .object({
      kind: z.literal("sets"),
      setIds: z
        .array(SetIdSchema)
        .min(1)
        .max(MAX_STUDY_SETS)
        .transform((ids) => [...new Set(ids)].sort()),
    })
    .strict(),
]);
export const StudyFilterSchema = z.enum(["all_available", "due_only"]);
export type StudyScope = z.infer<typeof StudyScopeSchema>;
export type StudyFilter = z.infer<typeof StudyFilterSchema>;

export function parseStudyQuery(search: URLSearchParams) {
  const kind = search.get("scope") ?? (search.has("set") ? "sets" : "all");
  const scope = StudyScopeSchema.parse({
    kind,
    ...(kind === "sets" || search.has("set")
      ? { setIds: search.getAll("set") }
      : {}),
  });
  const filter = StudyFilterSchema.parse(
    search.get("filter") ?? "all_available",
  );
  return { scope, filter };
}

export function studySearchParams(scope: StudyScope, filter: StudyFilter) {
  const search = new URLSearchParams({ scope: scope.kind, filter });
  if (scope.kind === "sets") {
    for (const id of scope.setIds) search.append("set", id);
  }
  return search;
}

export function studyHref(
  scope: StudyScope,
  filter: StudyFilter = "all_available",
) {
  return `/study?${studySearchParams(scope, filter)}`;
}
