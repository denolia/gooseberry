import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import ts from "@typescript/typescript6";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
after(() => fixture.close());

test("admin statistics execute after all migrations and count notes and enrichment usage by owner", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  await fixture.client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
  const sets = (
    await fixture.client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'First','fi','ru'),($2,'Other','fi','ru') RETURNING id,user_id",
      [userId, otherId],
    )
  ).rows;
  for (const set of sets) {
    const noteCount = set.user_id === userId ? 3 : 1;
    await fixture.client.query(
      `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,position)
       SELECT $1,'note-' || ordinal,'sana','слово',ordinal FROM generate_series(1,$2::int) ordinal`,
      [set.id, noteCount],
    );
  }
  await fixture.client.query(
    `INSERT INTO ai_usage (user_id,operation,model,status,input_words,input_tokens,output_tokens)
     VALUES ($1,'enrich','test','succeeded',2,100,40),($1,'enrich','test','failed',1,20,5),
            ($1,'translate','test','succeeded',3,10,20),($2,'enrich','test','pending',1,NULL,NULL)`,
    [userId, otherId],
  );
  let adminChecks = 0;
  const code = ts.transpileModule(
    readFileSync(new URL("../src/db/adminRepo.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const repo = {};
  new Function("require", "exports", code)((name) => {
    if (name === "@/lib/admin/requireAdmin")
      return {
        requireAdmin: async () => {
          adminChecks++;
        },
      };
    return fixture.load(name);
  }, repo);
  const result = await repo.getAdminUsers("", 1);
  assert.equal(adminChecks, 1);
  assert.equal(result.total, 2);
  const user = result.users.find((entry) => entry.id === userId);
  assert.equal(user.sets, 1);
  assert.equal(user.notes, 3);
  assert.equal(user.enrich_calls, 2);
  assert.equal(user.translate_calls, 1);
  assert.equal(user.successful_calls, 2);
  assert.equal(user.failed_calls, 1);
  assert.equal(user.pending_calls, 0);
  assert.equal(user.input_tokens, 130);
  assert.equal(user.output_tokens, 65);
  const other = result.users.find((entry) => entry.id === otherId);
  assert.equal(other.notes, 1);
  assert.equal(other.enrich_calls, 1);
  assert.equal(other.pending_calls, 1);
});
