import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as settings from "../src/lib/review/settings.ts";

function route(session = { user: { id: "user-1" } }) {
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/profile/route.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/auth": { auth: async () => session },
    "@/db/profileRepo": {
      updateUserPreferences: async (input) => {
        calls.push(input);
        return input;
      },
    },
    "@/lib/review/model": {
      isReviewMode: (value) => ["simple", "full"].includes(value),
    },
    "@/lib/review/settings": settings,
  };
  new Function("require", "exports", code)((name) => {
    if (!(name in dependencies))
      throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return {
    calls,
    patch: (body) =>
      exports.PATCH(
        new Request("http://localhost/api/profile", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      ),
  };
}

test("profile settings validate limits and timezone before saving", async () => {
  const api = route();
  for (const newWordsPerDay of [-1, 1.5, 1001, "20", null]) {
    assert.equal(
      (await api.patch({ reviewMode: "simple", newWordsPerDay })).status,
      400,
    );
  }
  assert.equal(
    (await api.patch({ reviewMode: "simple", studyTimeZone: "Not/AZone" }))
      .status,
    400,
  );
  assert.equal(api.calls.length, 0);
  assert.equal(
    (
      await api.patch({
        reviewMode: "full",
        newWordsPerDay: 0,
        studyTimeZone: "Europe/Berlin",
      })
    ).status,
    200,
  );
  assert.deepEqual(api.calls[0], {
    userId: "user-1",
    reviewMode: "full",
    newWordsPerDay: 0,
    studyTimeZone: "Europe/Berlin",
  });
});
test("legacy button-preference updates remain valid and authentication is required", async () => {
  assert.equal((await route().patch({ reviewMode: "simple" })).status, 200);
  const anonymous = route(null);
  assert.equal(
    (await anonymous.patch({ reviewMode: "simple", newWordsPerDay: 20 }))
      .status,
    401,
  );
  assert.equal(anonymous.calls.length, 0);
});
