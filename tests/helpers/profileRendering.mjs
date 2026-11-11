import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as nextIntl from "next-intl";
import ts from "@typescript/typescript6";
import * as languages from "../../src/components/ui/Languages.ts";
import * as reviewModel from "../../src/lib/review/model.ts";
import * as reviewSettings from "../../src/lib/review/settings.ts";
import * as locales from "../../src/i18n/locale.ts";
import { catalogs, loadSource, messageErrors } from "./i18n.mjs";

const i18n = loadSource(new URL("../../src/i18n/client.ts", import.meta.url), {
  "next-intl": nextIntl,
});

function loadComponent(path, dependencies) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: false,
      },
    },
  ).outputText;
  const shared = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: "a" },
    "@/i18n/client": i18n,
    "@/i18n/errors": messageErrors,
    "@/i18n/locale": locales,
    ...dependencies,
  };
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (!(name in shared)) throw new Error(`Unexpected dependency ${name}`);
    return shared[name];
  }, exports);
  return exports;
}

export function loadProfileClient(dependencies = {}) {
  return loadComponent("../../src/components/profile/ProfileClient.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/lib/review/model": reviewModel,
    "@/lib/review/settings": reviewSettings,
    "./ProfileClient.module.css": { default: {} },
    ...dependencies,
  }).ProfileClient;
}
const ProfileClient = loadProfileClient();
const { Header } = loadComponent("../../src/components/ui/Header.tsx", {
  "next-auth/react": {
    useSession: () => ({ data: { user: { name: "Test User" } } }),
  },
  "lucide-react": { ArrowRightLeft: () => null },
  "@/components/ui/Languages": languages,
  "@/lib/languages/useLanguages": {
    useLanguages: () => ({
      currentSourceLanguage: "English",
      currentTargetLanguage: "Russian",
    }),
  },
  "@/lib/languages/languageStore": { LanguageStore: {} },
  "./Header.module.css": { default: {} },
});

export function profileFixture(locale = "en") {
  return {
    name: "Test User",
    email: "test@example.com",
    imageUrl: null,
    tier: "free",
    createdAt: "2026-01-08T00:30:00.000Z",
    premiumGrantedAt: null,
    preferences: {
      uiLocale: locale,
      reviewMode: "simple",
      newWordsPerDay: 20,
      studyTimeZone: "Europe/Berlin",
    },
    pendingRequest: {
      id: "request-1",
      message: null,
      createdAt: "2026-11-11T23:30:00.000Z",
    },
  };
}

export function renderProfile(locale) {
  return renderToStaticMarkup(
    React.createElement(
      nextIntl.NextIntlClientProvider,
      {
        locale,
        messages: catalogs[locale],
        timeZone: "UTC",
        onError(error) {
          throw error;
        },
      },
      React.createElement(Header),
      React.createElement(ProfileClient, {
        initialProfile: profileFixture(locale),
      }),
    ),
  );
}
