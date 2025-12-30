import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  unique,
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
