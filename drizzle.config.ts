import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // IMPORTANT: use direct/unpooled for migrations
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
});
