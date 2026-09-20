import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  unique,
  uniqueIndex,
  integer,
  boolean,
  customType,
  bigserial,
  check,
  doublePrecision,
  primaryKey,
  smallint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Uint8Array; driverData: unknown }>({
  dataType() {
    return "bytea";
  },
});

export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(), // 'google'
    providerUserId: text("provider_user_id").notNull(), // Google "sub"
    email: text("email"),
    name: text("name"),
    imageUrl: text("image_url"),
    tier: text("tier").default("free").notNull(),
    premiumGrantedAt: timestamp("premium_granted_at", { withTimezone: true }),
    premiumGrantedBy: uuid("premium_granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => ({
    providerUserUnique: unique().on(t.provider, t.providerUserId),
  }),
);

export const userPreference = pgTable("user_preference", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => appUser.id, { onDelete: "cascade" }),
  defaultSourceLang: text("default_source_lang").default("German").notNull(),
  defaultTargetLang: text("default_target_lang").default("English").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const premiumRequest = pgTable(
  "premium_request",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
  },
  (t) => ({
    onePendingPerUser: uniqueIndex("premium_request_one_pending_user_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'pending'`),
    byStatusCreatedAt: index("premium_request_status_created_at_idx").on(
      t.status,
      t.createdAt,
    ),
  }),
);

export const speechAudioCache = pgTable("speech_audio_cache", {
  cacheKey: text("cache_key").primaryKey(),
  audioData: bytea("audio_data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const translationHistory = pgTable(
  "translation_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),

    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    inputText: text("input_text").notNull(),

    responseJson: jsonb("response_json").notNull(),

    model: text("model"),
    promptVersion: text("prompt_version"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byUserCreatedAt: index("translation_history_user_created_at_idx").on(
      t.userId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  }),
);

export const wordSet = pgTable(
  "word_set",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastExportedAt: timestamp("last_exported_at", { withTimezone: true }),
  },
  (t) => ({
    userIdIdx: index("word_set_user_id_idx").on(t.userId),
  }),
);

export const wordSetItem = pgTable(
  "word_set_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wordSetId: uuid("word_set_id")
      .notNull()
      .references(() => wordSet.id, { onDelete: "cascade" }),
    ankiNoteGuid: text("anki_note_guid").notNull(),

    // Study content fields (also mapped to the Gooseberry Anki note type)
    original: text("original").notNull(),
    translation: text("translation").notNull(),
    wordForms: text("word_forms").default("").notNull(),
    sample: text("sample").default("").notNull(),
    sampleTranslation: text("sample_translation").default("").notNull(),
    comments: text("comments").default("").notNull(),
    tags: text("tags").default("").notNull(),

    // Optional reference to source translation (for traceability)
    sourceTranslationId: uuid("source_translation_id"),

    isEnabled: boolean("is_enabled").default(true).notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    setIdPositionIdx: index("word_set_item_set_id_position_idx").on(
      t.wordSetId,
      t.position,
    ),
    guidIdx: index("word_set_item_guid_idx").on(t.ankiNoteGuid),
  }),
);

// A stable review identity for one prompt generated from a word-set item.
// The item owns the editable note content; this row only identifies the card.
export const studyCard = pgTable(
  "study_card",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wordSetItemId: uuid("word_set_item_id")
      .notNull()
      .references(() => wordSetItem.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("study_card_item_template_idx").on(
      t.wordSetItemId,
      t.templateKey,
    ),
    uniqueIndex("study_card_external_identity_idx")
      .on(t.wordSetItemId, t.externalSource, t.externalId)
      .where(
        sql`${t.externalSource} IS NOT NULL AND ${t.externalId} IS NOT NULL`,
      ),
    check(
      "study_card_template_key_not_blank_check",
      sql`char_length(trim(${t.templateKey})) > 0`,
    ),
    check(
      "study_card_external_identity_check",
      sql`(${t.externalSource} IS NULL AND ${t.externalId} IS NULL) OR (${t.externalSource} IS NOT NULL AND ${t.externalId} IS NOT NULL AND char_length(trim(${t.externalSource})) > 0 AND char_length(trim(${t.externalId})) > 0)`,
    ),
  ],
);

// Canonical review history. Scheduling state can always be rebuilt by replaying
// these events in reviewedAt/sequence order.
export const reviewEvent = pgTable(
  "review_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequence: bigserial("sequence", { mode: "number" }).unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    studyCardId: uuid("study_card_id")
      .notNull()
      .references(() => studyCard.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms"),
    source: text("source").default("gooseberry").notNull(),
    externalId: text("external_id"),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("review_event_card_history_idx").on(
      t.studyCardId,
      t.reviewedAt,
      t.sequence,
    ),
    index("review_event_user_history_idx").on(
      t.userId,
      t.reviewedAt,
      t.sequence,
    ),
    uniqueIndex("review_event_external_identity_idx")
      .on(t.userId, t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    check("review_event_rating_check", sql`${t.rating} BETWEEN 1 AND 4`),
    check(
      "review_event_duration_ms_check",
      sql`${t.durationMs} IS NULL OR ${t.durationMs} >= 0`,
    ),
    check(
      "review_event_source_not_blank_check",
      sql`char_length(trim(${t.source})) > 0`,
    ),
    check(
      "review_event_external_id_not_blank_check",
      sql`${t.externalId} IS NULL OR char_length(trim(${t.externalId})) > 0`,
    ),
  ],
);

// Replaceable FSRS projection. This table is a cache, not review history.
export const fsrsCardState = pgTable(
  "fsrs_card_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    studyCardId: uuid("study_card_id")
      .notNull()
      .references(() => studyCard.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    stability: doublePrecision("stability").default(0).notNull(),
    difficulty: doublePrecision("difficulty").default(0).notNull(),
    elapsedDays: integer("elapsed_days").default(0).notNull(),
    scheduledDays: integer("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    reps: integer("reps").default(0).notNull(),
    lapses: integer("lapses").default(0).notNull(),
    state: smallint("state").default(0).notNull(),
    revision: integer("revision").default(0).notNull(),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    lastReviewEventId: uuid("last_review_event_id").references(
      () => reviewEvent.id,
      { onDelete: "set null" },
    ),
    schedulerVersion: text("scheduler_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({
      name: "fsrs_card_state_pk",
      columns: [t.userId, t.studyCardId],
    }),
    index("fsrs_card_state_due_idx").on(t.userId, t.dueAt),
    check("fsrs_card_state_state_check", sql`${t.state} BETWEEN 0 AND 3`),
    check(
      "fsrs_card_state_nonnegative_check",
      sql`${t.stability} >= 0 AND ${t.difficulty} >= 0 AND ${t.elapsedDays} >= 0 AND ${t.scheduledDays} >= 0 AND ${t.learningSteps} >= 0 AND ${t.reps} >= 0 AND ${t.lapses} >= 0 AND ${t.revision} >= 0`,
    ),
    check(
      "fsrs_card_state_scheduler_version_not_blank_check",
      sql`char_length(trim(${t.schedulerVersion})) > 0`,
    ),
  ],
);

// Separate from saved history: unsuccessful calls may still consume tokens.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"),
    inputWords: integer("input_words").notNull(),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    responseId: text("response_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byUserCreatedAt: index("ai_usage_user_created_at_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);
