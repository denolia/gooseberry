import { getDb } from "@/db/drizzle";
import { studyCard, wordSetItem } from "@/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import {
  STUDY_CARD_TEMPLATES,
  STUDY_CARD_TEMPLATE_KEYS,
  getStudyCardTemplate,
  type StudyCardTemplateKey,
} from "@/lib/review/templates";

// Match JavaScript String.trim(), including nonbreaking spaces and BOMs that
// PostgreSQL's locale-dependent POSIX whitespace class may not recognize.
const CONTENT_WHITESPACE =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

// Derive availability from note content at read time. Identity and history must
// survive temporarily blank fields, so edits never delete or recreate cards.
export function eligibleStudyCardCondition() {
  return or(
    ...STUDY_CARD_TEMPLATES.map((template) =>
      and(
        eq(studyCard.templateKey, template.key),
        studyCardContentCondition(template.key),
      ),
    ),
  )!;
}

export function studyCardContentCondition(key: StudyCardTemplateKey) {
  return and(
    ...getStudyCardTemplate(key).requiredFields.map(
      (field) => sql`btrim(${wordSetItem[field]}, ${CONTENT_WHITESPACE}) <> ''`,
    ),
  )!;
}

// `drizzle-kit push` applies DDL but skips data migrations. Reconciliation also
// covers those environments without creating scheduling state or replacing IDs.
export async function ensureStudyCards(userId: string, wordSetId?: string) {
  const templateRows = sql.join(
    STUDY_CARD_TEMPLATE_KEYS.map((key) => sql`(${key}::text)`),
    sql`, `,
  );
  await getDb().execute(sql`
    INSERT INTO study_card (word_set_item_id, template_key, created_at)
    SELECT item.id, template.key,
      CASE WHEN template.key = 'recognition' THEN item.created_at ELSE now() END
    FROM word_set_item AS item
    INNER JOIN word_set AS owned_set ON owned_set.id = item.word_set_id
    CROSS JOIN (VALUES ${templateRows}) AS template(key)
    WHERE owned_set.user_id = ${userId}
      ${wordSetId ? sql`AND owned_set.id = ${wordSetId}` : sql``}
    ON CONFLICT (word_set_item_id, template_key) DO NOTHING
  `);
}
