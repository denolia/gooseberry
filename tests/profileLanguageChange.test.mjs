import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProfileClient,
  profileFixture,
} from "./helpers/profileRendering.mjs";
import { translations } from "./helpers/i18n.mjs";

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function setup(t, locale = "en") {
  const events = [];
  const response = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/profile");
    assert.equal(options.method, "PATCH");
    events.push({ type: "save", body: JSON.parse(options.body) });
    return response.promise;
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload: () => events.push({ type: "reload" }) } },
  });
  t.after(() => {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const state = [];
  let cursor = 0;
  const ProfileClient = loadProfileClient({
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = value;
          },
        ];
      },
    },
    "@/i18n/client": { useI18n: () => translations(locale) },
    "next/navigation": {
      useRouter: () => ({ refresh: () => events.push({ type: "refresh" }) }),
    },
  });
  const render = () => {
    cursor = 0;
    return nodes(ProfileClient({ initialProfile: profileFixture(locale) }));
  };
  const select = (value) =>
    render()
      .find((node) => node.props?.id === "interface-language")
      .props.onChange({ target: { value } });
  const submit = () =>
    render()
      .find(
        (node) =>
          node.type === "form" &&
          nodes(node).some((child) => child.props?.id === "interface-language"),
      )
      .props.onSubmit({ preventDefault() {} });
  return { events, response, render, select, submit };
}

for (const [from, to] of [
  ["en", "ru"],
  ["ru", "en"],
]) {
  test(`saving ${to} from ${from} reloads the page only after the preference is stored`, async (t) => {
    const ui = setup(t, from);
    ui.select(to);
    assert.deepEqual(ui.events, []);
    const saving = ui.submit();
    assert.equal(ui.events.length, 1);
    assert.deepEqual(ui.events[0], {
      type: "save",
      body: {
        uiLocale: to,
        reviewMode: "simple",
        newWordsPerDay: 20,
        studyTimeZone: "Europe/Berlin",
      },
    });
    ui.response.resolve(Response.json({ preferences: { uiLocale: to } }));
    await saving;
    assert.deepEqual(ui.events.slice(1), [{ type: "reload" }]);
  });
}

test("saving other settings keeps the page and refreshes its server data", async (t) => {
  const ui = setup(t);
  const saving = ui.submit();
  ui.response.resolve(Response.json({ preferences: { uiLocale: "en" } }));
  await saving;
  assert.deepEqual(ui.events.slice(1), [{ type: "refresh" }]);
  assert(
    ui
      .render()
      .some(
        (node) =>
          node.props?.role === "status" &&
          node.props.children ===
            translations().t("profileClient.settingsSaved"),
      ),
  );
});

test("a failed language save preserves the active language and shows its translated error", async (t) => {
  const ui = setup(t);
  ui.select("ru");
  const saving = ui.submit();
  ui.response.resolve(
    Response.json(
      { errorCode: "errors.couldNotSaveSettings" },
      { status: 500 },
    ),
  );
  await saving;
  assert.equal(ui.events.length, 1);
  assert(
    ui
      .render()
      .some(
        (node) =>
          node.type === "p" &&
          node.props.children ===
            translations().t("errors.couldNotSaveSettings"),
      ),
  );
});

test("the persisted locale determines whether to reload, rather than an unsaved selection", async (t) => {
  const ui = setup(t);
  ui.select("ru");
  const saving = ui.submit();
  ui.response.resolve(Response.json({ preferences: { uiLocale: "en" } }));
  await saving;
  assert.deepEqual(ui.events.slice(1), [{ type: "refresh" }]);
});
