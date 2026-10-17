import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const config = load("../src/lib/audio/readerConfig.ts");
const readerText = load("../src/lib/audio/readerText.ts", {
  "./readerConfig": config,
});
const languages = load("../src/components/ui/Languages.ts");

function nodes(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (tree?.props?.["aria-hidden"]) return "";
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

// Run dependency-aware effects so prop changes exercise the real cleanup path.
function setup(t, { props = {}, response, play = async () => {} } = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let mounted = true;
  const currentProps = {
    text: "Guten Morgen. Wie geht es dir?",
    sourceLanguage: "de",
    hasPremium: true,
    ...props,
  };
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) {
        hooks[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      }
      return [
        hooks[index].value,
        (value) => {
          const next =
            typeof value === "function" ? value(hooks[index].value) : value;
          if (!Object.is(next, hooks[index].value)) {
            hooks[index].value = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(current) {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!sameDeps(previous?.deps, deps)) {
        hooks[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
    useId() {
      const index = cursor++;
      return `reader-${index}`;
    },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps))
        hooks[index] = { deps, value: callback() };
      return hooks[index].value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
  };
  const requests = [];
  const audios = [];
  const revoked = [];
  const created = [];
  const timers = new Map();
  let timerId = 0;
  const storage = new Map();
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => {
    timers.delete(id);
  });
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class {
    constructor(url = "") {
      this.src = url;
      this.currentTime = 0;
      this.plays = 0;
      this.pauses = 0;
      this.error = null;
      audios.push(this);
    }
    play() {
      this.plays++;
      return play(this);
    }
    pause() {
      this.pauses++;
    }
    load() {
      this.currentTime = 0;
    }
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (!options.method || options.method === "GET") {
      return Response.json({
        voices: config.READER_VOICES,
        defaultVoice: "marin",
      });
    }
    const request = { url, options, body: JSON.parse(options.body) };
    requests.push(request);
    return response
      ? await response(request, requests.length)
      : new Response("mp3");
  });
  t.mock.method(URL, "createObjectURL", () => {
    const url = `blob:reader-${created.length + 1}`;
    created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const jsx = (type, props) => ({ type, props });
  const component = load("../src/components/analyzer/ReaderAudioPlayer.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { __esModule: true, default: "a" },
    "./ReaderAudioPlayer.module.css": { default: {} },
    "@/lib/audio/readerConfig": config,
    "@/lib/audio/readerText": readerText,
    "@/components/ui/Languages": languages,
  });
  function render(props = {}) {
    assert(mounted, "Cannot render an unmounted reader");
    Object.assign(currentProps, props);
    let tree;
    let renders = 0;
    do {
      assert(++renders < 20, "Reader effects never settle");
      dirty = false;
      cursor = 0;
      tree = component.ReaderAudioPlayer(currentProps);
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  function unmount() {
    if (!mounted) return;
    hooks.forEach((hook) => hook?.cleanup?.());
    mounted = false;
  }
  t.after(() => {
    unmount();
    if (originalStorage)
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  });
  return {
    audios,
    requests,
    revoked,
    created,
    timers,
    render,
    unmount,
    async ready() {
      render();
      await nextTick();
      render();
    },
    button(label) {
      const node = nodes(
        render(),
        (node) => node.type === "button" && text(node) === label,
      )[0];
      assert(node, `Missing button ${label}; rendered ${text(render())}`);
      return node;
    },
    async click(label) {
      const button = this.button(label);
      assert(!button.props.disabled, `Disabled button ${label}`);
      const pending = button.props.onClick();
      await nextTick();
      render();
      return pending;
    },
    async settle() {
      await nextTick();
      return render();
    },
    fireTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
    select(label, value) {
      const labels = nodes(render(), (node) => node.type === "label");
      const wrapper = labels.find((node) => text(node).startsWith(label));
      const select = nodes(wrapper, (node) => node.type === "select")[0];
      assert(select, `Missing select ${label}`);
      select.props.onChange({ target: { value } });
      render();
    },
  };
}

test("free accounts see the Premium banner and cannot start full-text audio", async (t) => {
  const player = setup(t, { props: { hasPremium: false } });
  await player.ready();
  assert.equal(player.button("Listen to full text").props.disabled, true);
  assert.match(text(player.render()), /available with Premium/);
  assert.equal(
    nodes(player.render(), (node) => node.type === "a")[0].props.href,
    "/profile",
  );
  assert.equal(player.requests.length, 0);
  assert.equal(player.audios.length, 0);
});

test("full text plays every bounded part in the source language using one audio element", async (t) => {
  const fullText = "Ein ganzer deutscher Satz. ".repeat(100).trim();
  const player = setup(t, { props: { text: fullText, sourceLanguage: "de" } });
  await player.ready();
  await player.click("Listen to full text");
  for (
    let index = 0;
    index < 10 && text(player.render()).includes("Pause");
    index++
  ) {
    assert.equal(player.requests.length, index + 1);
    player.audios[0].onended();
    await player.settle();
  }
  assert(
    player.requests.length > 2,
    "A text longer than 500 characters must continue to its end",
  );
  assert.equal(
    player.requests.map((request) => request.body.text).join(""),
    fullText,
  );
  assert(player.requests.every((request) => request.body.text.length <= 1000));
  assert(
    player.requests.every((request) => request.body.sourceLanguage === "de"),
  );
  assert(
    player.requests.every((request) => request.url === "/api/speech/reader"),
  );
  assert.equal(player.audios.length, 1);
  assert.equal(player.audios[0].plays, player.requests.length);
  assert.match(text(player.render()), /Finished reading/);
  assert(player.button("Listen again"));
});

test("pause and resume preserve the current audio position without another request", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen to full text");
  player.audios[0].currentTime = 12.5;
  await player.click("Pause");
  assert.match(text(player.render()), /Paused/);
  await player.click("Resume");
  assert.equal(player.audios[0].currentTime, 12.5);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.requests.length, 1);
});

test("a completed text replays from the beginning using its generated audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen to full text");
  player.audios[0].currentTime = 30;
  player.audios[0].onended();
  await player.settle();
  await player.click("Listen again");
  assert.equal(player.audios[0].currentTime, 0);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.requests.length, 1);
  assert.equal(player.audios.length, 1);
});

test("a media failure discards the broken part and Retry generates fresh audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen to full text");
  player.audios[0].onerror();
  await player.settle();
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  await player.click("Retry playback");
  assert.equal(player.requests.length, 2);
  assert.equal(player.audios[0].src, "blob:reader-2");
  assert.equal(player.audios[0].plays, 2);
});

test("pause while generating retains the result without playing until Resume", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen to full text").props.onClick();
  await player.settle();
  await player.click("Pause");
  pending.resolve(new Response("mp3"));
  await starting;
  await player.settle();
  assert.equal(player.audios[0].plays, 0);
  assert.equal(player.requests[0].options.signal.aborted, false);
  await player.click("Resume");
  assert.equal(player.requests.length, 1);
  assert.equal(player.audios[0].plays, 1);
});

test("Stop aborts generation and ignores its late result", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen to full text").props.onClick();
  await player.settle();
  await player.click("Stop");
  assert.equal(player.requests[0].options.signal.aborted, true);
  pending.resolve(new Response("late mp3"));
  await starting;
  await player.settle();
  assert.equal(player.created.length, 0);
  assert.equal(player.audios[0].plays, 0);
  assert(player.button("Listen to full text"));
});

test("blocked autoplay retains the generated part for a direct Resume tap", async (t) => {
  let attempts = 0;
  const player = setup(t, {
    play: async () => {
      if (++attempts === 1)
        throw new DOMException("Tap required", "NotAllowedError");
    },
  });
  await player.ready();
  await player.click("Listen to full text");
  assert.match(text(player.render()), /Playback needs a tap/);
  await player.click("Resume");
  assert.equal(player.requests.length, 1);
  assert.equal(attempts, 2);
  assert.equal(player.audios.length, 1);
  assert.deepEqual(player.revoked, []);
});

test("an interrupted pending play cannot overwrite a successful resume", async (t) => {
  const firstPlay = deferred();
  let attempts = 0;
  const player = setup(t, {
    play: () => (++attempts === 1 ? firstPlay.promise : Promise.resolve()),
  });
  await player.ready();
  const starting = player.button("Listen to full text").props.onClick();
  await player.settle();
  await player.click("Pause");
  await player.click("Resume");
  const pauses = player.audios[0].pauses;
  firstPlay.reject(new DOMException("Interrupted", "AbortError"));
  await starting;
  await player.settle();
  assert.equal(player.audios[0].pauses, pauses);
  assert.equal(player.requests.length, 1);
  assert(player.button("Pause"));
});

test("sentence pauses can be paused and resumed and Stop cancels their timer", async (t) => {
  const player = setup(t, {
    props: { text: "Erster Satz. Zweiter Satz. Dritter Satz." },
  });
  await player.ready();
  player.select("Reading speed", "normal-pauses");
  await player.click("Listen to full text");
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.timers.size, 1);
  assert.match(text(player.render()), /Sentence pause/);
  await player.click("Pause");
  assert.equal(player.timers.size, 0);
  player.fireTimers();
  assert.equal(player.requests.length, 1);
  await player.click("Resume");
  assert.equal(player.timers.size, 1);
  player.fireTimers();
  await player.settle();
  assert.equal(player.requests.length, 2);
  assert(
    player.requests.every((request) => request.body.speed === "normal-pauses"),
  );
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.timers.size, 1);
  await player.click("Stop");
  assert.equal(player.timers.size, 0);
  player.fireTimers();
  await player.settle();
  assert.equal(player.requests.length, 2);
});

test("changing text, source language, or Premium entitlement stops and discards audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen to full text");
  player.render({ text: "Ein neuer Text." });
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  await player.click("Listen to full text");
  player.render({ sourceLanguage: "fi" });
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1", "blob:reader-2"]);
  await player.click("Listen to full text");
  assert.equal(player.requests.at(-1).body.sourceLanguage, "fi");
  player.render({ hasPremium: false });
  assert.equal(player.audios[0].src, "");
  assert.equal(player.button("Listen to full text").props.disabled, true);
  assert.deepEqual(player.revoked, [
    "blob:reader-1",
    "blob:reader-2",
    "blob:reader-3",
  ]);
});

test("changing voice and speed resets playback and sends the new choices", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen to full text");
  player.select("Voice tone", "masculine");
  player.select("Voice name", "cedar");
  player.select("Reading speed", "very-slow");
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  await player.click("Listen to full text");
  assert.equal(player.requests.at(-1).body.voice, "cedar");
  assert.equal(player.requests.at(-1).body.speed, "very-slow");
});

test("unmount aborts pending audio and releases already generated object URLs", async (t) => {
  const pending = deferred();
  const player = setup(t, {
    props: { text: "Erster Satz. Zweiter Satz." },
    response: (_request, index) =>
      index === 1 ? new Response("mp3") : pending.promise,
  });
  await player.ready();
  player.select("Reading speed", "normal-pauses");
  await player.click("Listen to full text");
  player.audios[0].onended();
  player.fireTimers();
  await player.settle();
  assert.equal(player.requests.length, 2);
  player.unmount();
  assert.equal(player.requests[1].options.signal.aborted, true);
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  pending.resolve(new Response("late audio"));
  await nextTick();
  assert.equal(player.created.length, 1);
  assert.equal(player.audios[0].plays, 1);
});
