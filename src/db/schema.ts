import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  unique,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(), // 'google'
    providerUserId: text("provider_user_id").notNull(), // Google "sub"
    email: text("email"),
    name: text("name"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => ({
    providerUserUnique: unique().on(t.provider, t.providerUserId),
  }),
);

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
