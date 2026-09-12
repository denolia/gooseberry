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

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byUserCreatedAt: index("translation_history_user_created_at_idx").on(
      t.userId,
      t.createdAt,
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

    // Anki note fields
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
