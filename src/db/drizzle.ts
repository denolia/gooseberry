import { drizzle } from "drizzle-orm/neon-http";

type Database = ReturnType<typeof drizzle>;

let database: Database | undefined;

export function getDb(): Database {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Add it to .env.local before using database-backed features.",
    );
  }

  database ??= drizzle(databaseUrl);
  return database;
}
