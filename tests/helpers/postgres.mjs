import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import ts from "@typescript/typescript6";

const externalRequire = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../../", import.meta.url));

// Exercise the same display authorization as the browser before saving a grade.
// Reusing a review UUID must also reuse its presentation receipt after a retry.
export function createActivatedReviewer(repo) {
  const presentations = new Map();
  return async (input) => {
    let exposureId = presentations.get(input.reviewEventId);
    if (!exposureId) {
      const opened = await repo.activateReviewCard({
        userId: input.userId,
        wordSetId: input.wordSetId,
        studyCardId: input.studyCardId,
        exposureId: crypto.randomUUID(),
        now: input.reviewedAt,
      });
      exposureId = opened.exposure.id;
      presentations.set(input.reviewEventId, exposureId);
    }
    return repo.recordReview({ ...input, exposureId });
  };
}

// An isolated, in-memory PostgreSQL engine. Production SQL and migrations run
// unchanged; DATABASE_URL and all remote services are deliberately unused.
export async function createPostgresFixture() {
  const client = new PGlite();
  for (const name of readdirSync(path.join(project, "migrations"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    await client.exec(
      readFileSync(path.join(project, "migrations", name), "utf8"),
    );
  }
  const database = drizzle(client);
  const dialect = new PgDialect();
  database.batch = (queries) =>
    client.transaction(async (transaction) => {
      const results = [];
      for (const query of queries) {
        const statement = query.getQuery
          ? query.getQuery()
          : dialect.sqlToQuery(query.getSQL());
        results.push(await transaction.query(statement.sql, statement.params));
      }
      return results;
    });
  const modules = new Map();
  function load(name, parent = path.join(project, "src")) {
    if (name === "@/db/drizzle") return { getDb: () => database };
    const filename = name.startsWith("@/")
      ? path.join(project, "src", `${name.slice(2)}.ts`)
      : name.startsWith(".")
        ? path.resolve(parent, `${name}.ts`)
        : null;
    if (!filename) return externalRequire(name);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("require", "exports", code)(
      (dependency) => load(dependency, path.dirname(filename)),
      exports,
    );
    return exports;
  }
  return { client, database, load, close: () => client.close() };
}
