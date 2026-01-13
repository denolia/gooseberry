import { z } from "zod";

export const AnkiNoteSchema = z.object({
  original: z.string(),
  translation: z.string(),
  wordForms: z.string(),
  sample: z.string(),
  sampleTranslation: z.string(),
  comments: z.string(),
  tags: z.string(),
  sourceId: z.string(), // translation_history.id
  guid: z.string(), // Stable GUID for updates
});

export type AnkiNote = z.infer<typeof AnkiNoteSchema>;
