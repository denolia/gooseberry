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
const audioCache = load("../src/lib/audio/readerAudioCache.ts", {
  "@/components/ui/Languages": languages,
});

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
function setup(
  t,
  {
    props = {},
    response,
    play = async (audio) => audio.onplaying?.(),
    geometry = false,
    storedSettings,
    cacheBytes,
    cacheEntries,
  } = {},
) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let mounted = true;
  const readingRanges = [];
  const activeChanges = [];
  const currentProps = {
    text: "Guten Morgen.",
    sourceLanguage: "de",
    hasPremium: true,
    onReadingRangeChange: (range) => readingRanges.push(range),
    onPlaybackActiveChange: (active) => activeChanges.push(active),
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
  const audioCaches = [];
  const timers = new Map();
  let timerId = 0;
  const storage = new Map();
  if (storedSettings)
    storage.set("readerAudioSettings:v1", JSON.stringify(storedSettings));
  let controlsBottom = 100;
  const frames = new Map();
  let frameId = 0;
  const observers = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalObserver = Object.getOwnPropertyDescriptor(
    globalThis,
    "IntersectionObserver",
  );
  const viewport = Object.assign(new EventTarget(), { offsetTop: 0 });
  const browser = Object.assign(new EventTarget(), {
    visualViewport: viewport,
    requestAnimationFrame(callback) {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  const controlsElement = {
    getBoundingClientRect: () => ({
      top: controlsBottom - 44,
      bottom: controlsBottom,
    }),
  };
  if (geometry) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browser,
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value:
        geometry === "fallback"
          ? undefined
          : class {
              constructor(callback) {
                this.callback = callback;
                observers.push(this);
              }
              observe(element) {
                this.element = element;
              }
              disconnect() {
                this.disconnected = true;
              }
            },
    });
  }
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
      this.defaultPlaybackRate = 1;
      this.playbackRate = 1;
      this.preservesPitch = false;
      this.src = url;
      this.currentTime = 0;
      this.plays = 0;
      this.pauses = 0;
      this.loads = 0;
      this.error = null;
      audios.push(this);
    }
    get src() {
      return this._src;
    }
    set src(value) {
      this._src = value;
      this.currentTime = 0;
      this.playbackRate = this.defaultPlaybackRate;
    }
    play() {
      this.plays++;
      return play(this);
    }
    pause() {
      this.pauses++;
    }
    load() {
      this.loads++;
      this.currentTime = 0;
      this.playbackRate = this.defaultPlaybackRate;
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
    "@/lib/audio/readerAudioCache": {
      ...audioCache,
      ReaderAudioCache: class extends audioCache.ReaderAudioCache {
        constructor() {
          super(cacheBytes, cacheEntries);
          audioCaches.push(this);
        }
      },
    },
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
      if (geometry) {
        for (const node of nodes(
          tree,
          (node) => node.type === "div" && node.props?.ref,
        ))
          node.props.ref.current = controlsElement;
      }
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
    if (geometry) {
      if (originalWindow)
        Object.defineProperty(globalThis, "window", originalWindow);
      else delete globalThis.window;
      if (originalObserver)
        Object.defineProperty(
          globalThis,
          "IntersectionObserver",
          originalObserver,
        );
      else delete globalThis.IntersectionObserver;
    }
  });
  return {
    audios,
    requests,
    revoked,
    created,
    audioCaches,
    timers,
    storage,
    readingRanges,
    activeChanges,
    get playbackActive() {
      return activeChanges.at(-1) ?? false;
    },
    get readingRange() {
      return readingRanges.at(-1) ?? null;
    },
    render,
    unmount,
    dock() {
      return nodes(
        render(),
        (node) => node.props?.["aria-label"] === "Floating playback controls",
      )[0];
    },
    async clickDock(label) {
      const button = nodes(
        this.dock(),
        (node) => node.type === "button" && text(node) === label,
      )[0];
      assert(
        button && !button.props.disabled,
        `Missing enabled dock button ${label}`,
      );
      const pending = button.props.onClick();
      await nextTick();
      render();
      return pending;
    },
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
      return render();
    },
    scrollControlsTo(bottom) {
      controlsBottom = bottom;
      browser.dispatchEvent(new Event("scroll"));
      return this.flushFrames();
    },
    intersectControlsAt(bottom) {
      controlsBottom = bottom;
      observers.at(-1).callback([]);
      return this.flushFrames();
    },
    shiftVisualViewport(offsetTop) {
      viewport.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event("resize"));
      return this.flushFrames();
    },
    get pendingFrames() {
      return frames.size;
    },
    get observedControlsDisconnected() {
      return observers.every((observer) => observer.disconnected);
    },
    async ready() {
      render();
      if (geometry) this.flushFrames();
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
    speed() {
      return nodes(
        render(),
        (node) => node.type === "input" && node.props.type === "range",
      )[0];
    },
    setSpeed(index) {
      this.speed().props.onChange({ target: { value: String(index) } });
      render();
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
  assert.equal(player.button("Listen").props.disabled, true);
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
  await player.click("Listen");
  for (
    let index = 0;
    index < 100 && text(player.render()).includes("Pause");
    index++
  ) {
    assert.equal(player.requests.length, 1);
    player.audios[0].onended();
    await player.settle();
  }
  assert.equal(
    player.requests.length,
    1,
    "Repeated sentences should share generated audio",
  );
  assert(player.requests.every((request) => request.body.text.length <= 1000));
  assert(
    player.requests.every((request) => request.body.sourceLanguage === "de"),
  );
  assert(
    player.requests.every((request) => request.url === "/api/speech/reader"),
  );
  assert.equal(player.audios.length, 1);
  assert.equal(player.audios[0].plays, 100);
  assert.match(text(player.render()), /Finished reading/);
  assert(player.button("Replay"));
  assert.equal(player.readingRange, null);
});

test("pause and resume preserve the current audio position without another request", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  const readingRange = player.readingRange;
  assert.deepEqual(readingRange, { start: 0, end: 13 });
  player.audios[0].currentTime = 12.5;
  await player.click("Pause");
  assert.deepEqual(player.readingRange, readingRange);
  assert.match(text(player.render()), /Paused/);
  await player.click("Resume");
  assert.deepEqual(player.readingRange, readingRange);
  assert.equal(player.audios[0].currentTime, 12.5);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.requests.length, 1);
});

test("a completed text replays from the beginning using its generated audio", async (t) => {
  const player = setup(t, { props: { text: "Guten Morgen." } });
  await player.ready();
  await player.click("Listen");
  player.audios[0].currentTime = 30;
  player.audios[0].onended();
  await player.settle();
  await player.click("Replay");
  assert.equal(player.audios[0].currentTime, 0);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.requests.length, 1);
  assert.equal(player.audios.length, 1);
});

test("a media failure discards the broken part and Retry generates fresh audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  player.audios[0].onerror();
  await player.settle();
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  assert.equal(player.readingRange, null);
  await player.click("Retry");
  assert.equal(player.requests.length, 2);
  assert.equal(player.audios[0].src, "blob:reader-2");
  assert.equal(player.audios[0].plays, 2);
});

test("pause while generating retains the result without playing until Resume", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  await player.click("Pause");
  assert.equal(player.readingRange, null);
  pending.resolve(new Response("mp3"));
  await starting;
  await player.settle();
  assert.equal(player.audios[0].plays, 0);
  assert.equal(player.readingRange, null);
  assert.equal(player.requests[0].options.signal.aborted, false);
  await player.click("Resume");
  assert.equal(player.requests.length, 1);
  assert.equal(player.audios[0].plays, 1);
});

test("Pause and Resume before the current request finishes start its shared audio exactly once", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  await player.click("Pause");
  const resuming = player.button("Resume").props.onClick();
  await player.settle();
  assert.equal(player.requests.length, 1);
  assert.equal(player.requests[0].options.signal.aborted, false);
  pending.resolve(new Response("mp3"));
  await Promise.all([starting, resuming]);
  await player.settle();
  assert.equal(player.audios[0].plays, 1);
  assert.equal(player.created.length, 1);
  assert.deepEqual(player.readingRange, { start: 0, end: 13 });
});

test("replacing text aborts generation and ignores its late result", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  player.render({ text: "Neuer Text." });
  assert.equal(player.requests[0].options.signal.aborted, true);
  pending.resolve(new Response("late mp3"));
  await starting;
  await player.settle();
  assert.equal(player.created.length, 0);
  assert.equal(player.audios[0].plays, 0);
  assert(player.button("Listen"));
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
  await player.click("Listen");
  assert.match(text(player.render()), /Playback needs a tap/);
  assert.equal(player.readingRange, null);
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
  const starting = player.button("Listen").props.onClick();
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

test("the stored .7 speed is a continuous playback rate without sentence-gap timers", async (t) => {
  const player = setup(t, {
    props: { text: "Erster Satz. Zweiter Satz. Dritter Satz." },
  });
  await player.ready();
  player.setSpeed(2);
  await player.click("Listen");
  assert.equal(player.audios[0].playbackRate, 0.7);
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.timers.size, 0);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.audios[0].playbackRate, 0.7);
  assert.equal(player.playbackActive, true);
  assert.doesNotMatch(text(player.render()), /Sentence pause/);
  assert(player.requests.every((request) => !("speed" in request.body)));
});

test("changing text, source language, or Premium entitlement stops and discards audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  player.render({ text: "Ein neuer Text." });
  assert.equal(player.readingRange, null);
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  await player.click("Listen");
  player.render({ sourceLanguage: "fi" });
  assert.equal(player.readingRange, null);
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1", "blob:reader-2"]);
  await player.click("Listen");
  assert.equal(player.requests.at(-1).body.sourceLanguage, "fi");
  player.render({ hasPremium: false });
  assert.equal(player.readingRange, null);
  assert.equal(player.audios[0].src, "");
  assert.equal(player.button("Listen").props.disabled, true);
  assert.deepEqual(player.revoked, [
    "blob:reader-1",
    "blob:reader-2",
    "blob:reader-3",
  ]);
});

test("changing the actual voice resets audio while changing speed only sets the local rate", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  player.select("Voice name", "cedar");
  player.setSpeed(0);
  assert.equal(player.readingRange, null);
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  await player.click("Listen");
  assert.equal(player.requests.at(-1).body.voice, "cedar");
  assert.equal("speed" in player.requests.at(-1).body, false);
  assert.equal(player.audios[0].playbackRate, 0.3);
});

test("the native five-position speed slider changes real audio rates without restarting or regenerating", async (t) => {
  const player = setup(t);
  await player.ready();
  assert.deepEqual(
    config.READER_SPEEDS.map((speed) => speed.speed),
    [0.3, 0.5, 0.7, 1, 1.5],
  );
  const initial = player.speed().props;
  assert.equal(initial.min, 0);
  assert.equal(initial.max, 4);
  assert.equal(initial.step, 1);
  assert.equal(initial.value, 3);
  assert.equal(initial["aria-label"], "Reading speed");
  assert.equal(initial["aria-valuetext"], "1× — Normal");
  player.setSpeed(0);
  assert.equal(player.audios.length, 0, "An idle slider must not create audio");
  await player.click("Listen");
  const audio = player.audios[0];
  audio.currentTime = 12.5;
  const before = {
    url: audio.src,
    plays: audio.plays,
    pauses: audio.pauses,
    loads: audio.loads,
    range: player.readingRange,
    active: player.playbackActive,
  };
  for (const [index, speed] of config.READER_SPEEDS.entries()) {
    player.setSpeed(index);
    assert.equal(player.speed().props.value, index);
    assert.equal(
      player.speed().props["aria-valuetext"],
      `${speed.speed}× — ${speed.label}`,
    );
    assert.equal(audio.playbackRate, speed.speed);
    assert.equal(audio.defaultPlaybackRate, speed.speed);
    assert.equal(audio.preservesPitch, true);
    assert.equal(audio.currentTime, 12.5);
    assert.deepEqual(
      {
        url: audio.src,
        plays: audio.plays,
        pauses: audio.pauses,
        loads: audio.loads,
        range: player.readingRange,
        active: player.playbackActive,
      },
      before,
    );
    assert.equal(player.requests.length, 1);
    assert.equal(player.audios.length, 1);
    assert.equal(player.requests[0].options.signal.aborted, false);
    assert.equal("speed" in player.requests[0].body, false);
    assert.deepEqual(player.created, ["blob:reader-1"]);
    assert.deepEqual(player.revoked, []);
    assert(player.button("Pause"));
  }
});

test("changing speed while paused preserves position, highlight, URL and pause until explicit Resume", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  const audio = player.audios[0];
  audio.currentTime = 7.25;
  await player.click("Pause");
  const before = {
    url: audio.src,
    plays: audio.plays,
    pauses: audio.pauses,
    loads: audio.loads,
    range: player.readingRange,
  };
  player.setSpeed(0);
  player.setSpeed(4);
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.currentTime, 7.25);
  assert.deepEqual(
    {
      url: audio.src,
      plays: audio.plays,
      pauses: audio.pauses,
      loads: audio.loads,
      range: player.readingRange,
    },
    before,
  );
  assert.equal(player.playbackActive, false);
  assert.equal(player.requests.length, 1);
  assert(player.button("Resume"));
  await player.click("Resume");
  assert.equal(audio.currentTime, 7.25);
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.plays, before.plays + 1);
});

test("speed changes during generation preserve the pending request and use the latest rate after a paused load", async (t) => {
  const pending = deferred();
  const player = setup(t, { response: () => pending.promise });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  const audio = player.audios[0];
  player.setSpeed(0);
  assert.equal(player.requests.length, 1);
  assert.equal(player.requests[0].options.signal.aborted, false);
  assert.equal(audio.playbackRate, 0.3);
  assert.equal(audio.plays, 0);
  assert.equal(audio.loads, 0);
  assert.equal(audio.pauses, 0);
  assert(player.button("Pause"));
  await player.click("Pause");
  const pauseCount = audio.pauses;
  player.setSpeed(4);
  pending.resolve(new Response("mp3"));
  await starting;
  await player.settle();
  assert.equal(audio.plays, 0);
  assert.equal(audio.pauses, pauseCount);
  assert.equal(player.readingRange, null);
  assert.equal(player.playbackActive, false);
  assert.equal(player.requests[0].options.signal.aborted, false);
  assert(player.button("Resume"));
  await player.click("Resume");
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.defaultPlaybackRate, 1.5);
  assert.equal(player.requests.length, 1);
});

test("live speed keeps lookahead in flight and applies to subsequent sources and cached replay", async (t) => {
  const nextResponse = deferred();
  const player = setup(t, {
    props: { text: "Eins. Zwei." },
    response: (_request, index) =>
      index === 2 ? nextResponse.promise : new Response("mp3"),
  });
  await player.ready();
  await player.click("Listen");
  const audio = player.audios[0];
  audio.currentTime = 3;
  const before = {
    url: audio.src,
    plays: audio.plays,
    pauses: audio.pauses,
    loads: audio.loads,
    range: player.readingRange,
  };
  player.setSpeed(4);
  assert.equal(player.requests.length, 2);
  assert(
    player.requests.every(
      (request) =>
        !request.options.signal.aborted && !("speed" in request.body),
    ),
  );
  assert.equal(audio.currentTime, 3);
  assert.deepEqual(
    {
      url: audio.src,
      plays: audio.plays,
      pauses: audio.pauses,
      loads: audio.loads,
      range: player.readingRange,
    },
    before,
  );
  nextResponse.resolve(new Response("next mp3"));
  await player.settle();
  audio.onended();
  await player.settle();
  assert.equal(audio.src, "blob:reader-2");
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.defaultPlaybackRate, 1.5);
  audio.onended();
  await player.settle();
  const completedPlays = audio.plays;
  player.setSpeed(1);
  assert(player.button("Replay"));
  assert.equal(audio.plays, completedPlays);
  await player.click("Replay");
  assert.equal(audio.src, "blob:reader-1");
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playbackRate, 0.5);
  assert.equal(audio.defaultPlaybackRate, 0.5);
  assert.equal(player.requests.length, 2);
  assert.equal(player.audios.length, 1);
});

test("all named voices remain available and stored tone metadata does not change the selected voice", async (t) => {
  const player = setup(t, {
    storedSettings: {
      version: 1,
      voice: "cedar",
      speed: "normal",
      style: "feminine",
    },
  });
  await player.ready();
  const label = nodes(player.render(), (node) => node.type === "label").find(
    (node) => text(node).startsWith("Voice name"),
  );
  const select = nodes(label, (node) => node.type === "select")[0];
  assert.equal(select.props.value, "cedar");
  assert.deepEqual(
    nodes(select, (node) => node.type === "option").map(
      (node) => node.props.value,
    ),
    config.READER_VOICES.map((voice) => voice.id),
  );
  await player.click("Listen");
  assert.equal(player.requests[0].body.voice, "cedar");
  assert.equal(
    "style" in JSON.parse(player.storage.get("readerAudioSettings:v1")),
    false,
  );
  player.select("Voice name", "marin");
  await player.click("Listen");
  assert.equal(player.requests[1].body.voice, "marin");
});

test("returning to edited text reuses its Blob across whitespace, speed and language aliases with a fresh URL", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  const originalUrl = player.audios[0].src;
  player.render({ text: "Anderer Text." });
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  player.setSpeed(4);
  player.render({ text: "  Guten Morgen.  ", sourceLanguage: "German" });
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  assert.notEqual(player.audios[0].src, originalUrl);
  assert(player.revoked.includes(originalUrl));
  assert.deepEqual(player.readingRange, { start: 2, end: 15 });
  assert.equal(player.audios[0].playbackRate, 1.5);
  assert.equal(player.audioCaches[0].size, 2);
});

test("source language and named voice have distinct content-cache entries and returning to either reuses audio", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  player.select("Voice name", "cedar");
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  assert.equal(player.requests[1].body.voice, "cedar");
  player.select("Voice name", "marin");
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  player.render({ sourceLanguage: "fi" });
  await player.click("Listen");
  assert.equal(player.requests.length, 3);
  assert.equal(player.requests[2].body.sourceLanguage, "fi");
  player.render({ sourceLanguage: "de" });
  await player.click("Listen");
  assert.equal(player.requests.length, 3);
  assert.equal(player.audioCaches[0].size, 3);
  assert.deepEqual(
    player.requests.map(({ body }) => [
      body.text.trim(),
      body.sourceLanguage,
      body.voice,
    ]),
    [
      ["Guten Morgen.", "de", "marin"],
      ["Guten Morgen.", "de", "cedar"],
      ["Guten Morgen.", "fi", "marin"],
    ],
  );
});

test("a media failure evicts the shared Blob and every duplicate-sentence URL before retry", async (t) => {
  const player = setup(t, { props: { text: "Eins. Eins." } });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.requests.length, 1);
  assert.deepEqual(player.created, ["blob:reader-1", "blob:reader-2"]);
  assert.equal(player.audioCaches[0].size, 1);
  player.audios[0].onerror();
  await player.settle();
  assert.deepEqual(player.revoked, ["blob:reader-1", "blob:reader-2"]);
  assert.equal(player.audioCaches[0].size, 0);
  await player.click("Retry");
  assert.equal(player.requests.length, 2);
  assert.equal(player.audios[0].src, "blob:reader-3");
  assert.equal(player.audioCaches[0].size, 1);
});

test("bounded content-cache eviction causes a fresh download while recent entries remain reusable", async (t) => {
  const player = setup(t, { props: { text: "Eins." }, cacheEntries: 2 });
  await player.ready();
  for (const sentence of ["Eins.", "Zwei.", "Drei."]) {
    player.render({ text: sentence });
    await player.click("Listen");
  }
  assert.equal(player.requests.length, 3);
  assert.equal(player.audioCaches[0].size, 2);
  player.render({ text: "Zwei." });
  await player.click("Listen");
  assert.equal(player.requests.length, 3);
  player.render({ text: "Eins." });
  await player.click("Listen");
  assert.equal(player.requests.length, 4);
  assert.equal(player.audioCaches[0].size, 2);
});

test("account and Premium entitlement changes clear reusable audio bytes", async (t) => {
  const player = setup(t, { props: { accountId: "account-a" } });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.audioCaches[0].size, 1);
  player.render({ accountId: "account-b" });
  assert.equal(player.audioCaches[0].size, 0);
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  player.render({ hasPremium: false });
  assert.equal(player.audioCaches[0].size, 0);
  player.render({ hasPremium: true });
  await player.settle();
  await player.click("Listen");
  assert.equal(player.requests.length, 3);
  player.unmount();
  assert.equal(player.audioCaches[0].size, 0);
  assert.equal(player.audioCaches[0].byteLength, 0);
});

test("late aborted lookahead cannot refill a cleared account cache", async (t) => {
  const pendingNext = deferred();
  const player = setup(t, {
    props: { accountId: "account-a", text: "Eins. Zwei." },
    response: (_request, index) =>
      index === 2 ? pendingNext.promise : new Response("mp3"),
  });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.audioCaches[0].size, 1);
  player.render({ accountId: "account-b" });
  assert.equal(player.requests[1].options.signal.aborted, true);
  pendingNext.resolve(new Response("late audio"));
  await player.settle();
  assert.equal(player.audioCaches[0].size, 0);
  player.render({ text: "Zwei." });
  await player.click("Listen");
  assert.equal(player.requests.length, 3);
});

test("saved Slower speed restores .7 playback without creating audio before Listen", async (t) => {
  const player = setup(t, {
    storedSettings: {
      version: 1,
      voice: "marin",
      speed: "Slower",
    },
  });
  await player.ready();
  assert.equal(player.speed().props.value, 2);
  assert.equal(player.speed().props["aria-valuetext"], "0.7× — Slower");
  assert.equal(
    JSON.parse(player.storage.get("readerAudioSettings:v1")).speed,
    "Slower",
  );
  assert.equal(player.audios.length, 0);
  await player.click("Listen");
  assert.equal(player.audios[0].playbackRate, 0.7);
  assert.equal(player.audios[0].defaultPlaybackRate, 0.7);
  assert.equal(player.audios[0].preservesPitch, true);
  assert.equal("speed" in player.requests[0].body, false);
  player.setSpeed(4);
  assert.equal(
    JSON.parse(player.storage.get("readerAudioSettings:v1")).speed,
    "fast",
  );
});

test("highlight waits for actual playback and late media events cannot restore it after replacing text", async (t) => {
  const pendingPlay = deferred();
  const player = setup(t, {
    props: { text: "  Hallo.  " },
    play: () => pendingPlay.promise,
  });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  assert.equal(player.readingRange, null);
  assert.equal(player.playbackActive, false);
  const waitingAudio = player.audios[0];
  const waitingUrl = waitingAudio.src;
  player.setSpeed(4);
  assert.equal(waitingAudio.playbackRate, 1.5);
  assert.equal(waitingAudio.src, waitingUrl);
  assert.equal(waitingAudio.plays, 1);
  assert.equal(waitingAudio.pauses, 0);
  assert.equal(waitingAudio.loads, 0);
  assert.equal(player.requests.length, 1);
  assert.equal(player.readingRange, null);
  const onplaying = player.audios[0].onplaying;
  const onerror = player.audios[0].onerror;
  onplaying();
  assert.equal(player.playbackActive, true);
  assert.deepEqual(player.readingRange, { start: 2, end: 8 });
  await player.click("Pause");
  assert.equal(player.playbackActive, false);
  assert.deepEqual(player.readingRange, { start: 2, end: 8 });
  player.render({ text: "Neuer Text." });
  assert.equal(player.readingRange, null);
  assert.equal(player.playbackActive, false);
  onplaying();
  onerror();
  pendingPlay.resolve();
  await starting;
  await player.settle();
  assert.equal(player.readingRange, null);
  assert.equal(player.audios[0].onplaying, null);
  assert.equal(player.playbackActive, false);
  assert(player.button("Listen"));
});

test("repeated sentences reuse audio, highlight their original offsets, and replay from the first sentence", async (t) => {
  const player = setup(t, {
    props: { text: "  Hallo. Hallo.  " },
  });
  await player.ready();
  await player.click("Listen");
  assert.deepEqual(player.readingRange, { start: 2, end: 8 });
  player.audios[0].onended();
  assert.equal(player.readingRange, null);
  await player.settle();
  assert.deepEqual(player.readingRange, { start: 9, end: 15 });
  await player.click("Pause");
  await player.click("Resume");
  assert.deepEqual(player.readingRange, { start: 9, end: 15 });
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.readingRange, null);
  await player.click("Replay");
  assert.deepEqual(player.readingRange, { start: 2, end: 8 });
  assert.equal(player.requests.length, 1);
});

test("delayed playing and error callbacks from an old text cannot alter the new sentence highlight", async (t) => {
  const player = setup(t);
  await player.ready();
  await player.click("Listen");
  const oldPlaying = player.audios[0].onplaying;
  const oldError = player.audios[0].onerror;
  player.render({ text: "  Neuer Text." });
  oldPlaying();
  assert.equal(player.readingRange, null);
  await player.click("Listen");
  assert.deepEqual(player.readingRange, { start: 2, end: 13 });
  oldPlaying();
  oldError();
  assert.deepEqual(player.readingRange, { start: 2, end: 13 });
  assert(player.button("Pause"));
});

test("long sentence pieces share one full sentence range without artificial speed-dependent gaps", async (t) => {
  const longSentence = `${"Wort ".repeat(430)}endet.`;
  const player = setup(t, {
    props: { text: `${longSentence} Danach.` },
  });
  const chunks = readerText.getReaderSpeechChunks(
    `${longSentence} Danach.`,
    "de",
  );
  const firstSentencePieces = chunks.filter(
    (chunk) => chunk.sentenceIndex === 0,
  );
  assert(firstSentencePieces.length > 1);
  await player.ready();
  player.setSpeed(2);
  await player.click("Listen");
  const fullRange = { start: 0, end: longSentence.length };
  assert.deepEqual(player.readingRange, fullRange);
  for (let index = 1; index < firstSentencePieces.length; index++) {
    player.audios[0].onended();
    assert.equal(player.timers.size, 0);
    await player.settle();
    assert.deepEqual(player.readingRange, fullRange);
  }
  player.audios[0].onended();
  assert.equal(player.readingRange, null);
  assert.equal(player.timers.size, 0);
  await player.settle();
  assert.deepEqual(player.readingRange, {
    start: longSentence.length + 1,
    end: longSentence.length + 8,
  });
});

test("playback reports through the latest range callback without restarting audio", async (t) => {
  const player = setup(t, {
    props: { text: "Guten Morgen. Wie geht es dir?" },
  });
  const latestRanges = [];
  await player.ready();
  await player.click("Listen");
  const originalCalls = player.readingRanges.length;
  player.render({ onReadingRangeChange: (range) => latestRanges.push(range) });
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.readingRanges.length, originalCalls);
  assert.deepEqual(latestRanges, [null, { start: 14, end: 30 }]);
  assert.equal(player.requests.length, 2);
});

test("only the next sentence is prefetched and a cached transition does not generate it again or highlight it early", async (t) => {
  const player = setup(t, { props: { text: "Eins. Zwei. Drei." } });
  await player.ready();
  await player.click("Listen");
  assert.deepEqual(
    player.requests.map((request) => request.body.text),
    ["Eins. ", "Zwei. "],
  );
  assert.deepEqual(player.readingRange, { start: 0, end: 5 });
  assert.equal(player.audios[0].plays, 1);
  assert.equal(player.created.length, 2);
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.audios[0].src, "blob:reader-2");
  assert.equal(player.audios[0].plays, 2);
  assert.deepEqual(player.readingRange, { start: 6, end: 11 });
  assert.deepEqual(
    player.requests.map((request) => request.body.text),
    ["Eins. ", "Zwei. ", "Drei."],
  );
});

test("lookahead waits for actual playback and native onset plus play-promise resolution share one next request", async (t) => {
  const pendingPlay = deferred();
  const player = setup(t, {
    props: { text: "Eins. Zwei. Drei." },
    play: () => pendingPlay.promise,
  });
  await player.ready();
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  assert.equal(player.requests.length, 1);
  assert.equal(player.readingRange, null);
  assert.equal(player.playbackActive, false);
  player.audios[0].onplaying();
  player.audios[0].onplaying();
  await player.settle();
  assert.deepEqual(player.readingRange, { start: 0, end: 5 });
  assert.deepEqual(
    player.requests.map((request) => request.body.text),
    ["Eins. ", "Zwei. "],
  );
  pendingPlay.resolve();
  await starting;
  await player.settle();
  assert.equal(player.requests.length, 2);
  assert.equal(player.created.length, 2);
  assert.equal(player.audios[0].plays, 1);
  assert.deepEqual(player.activeChanges, [true]);
});

test("floating controls appear only above the visual viewport while playback is available", async (t) => {
  const player = setup(t, { geometry: true });
  await player.ready();
  player.scrollControlsTo(-10);
  assert.equal(player.dock(), undefined);
  await player.click("Listen");
  assert(player.dock());
  player.scrollControlsTo(100);
  assert.equal(player.dock(), undefined);
  player.scrollControlsTo(900);
  assert.equal(player.dock(), undefined);
  player.intersectControlsAt(8);
  assert(player.dock());
  player.intersectControlsAt(8.1);
  assert.equal(player.dock(), undefined);
  player.shiftVisualViewport(40);
  assert(player.dock());
  player.shiftVisualViewport(0);
  assert.equal(player.dock(), undefined);
  player.scrollControlsTo(-10);
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.dock(), undefined);
});

test("floating Pause and Resume reuse the main player's audio and requests with a scroll fallback", async (t) => {
  const player = setup(t, { geometry: "fallback" });
  await player.ready();
  await player.click("Listen");
  player.scrollControlsTo(-5);
  assert(player.dock());
  const originalRange = player.readingRange;
  await player.clickDock("Pause");
  assert.equal(player.playbackActive, false);
  assert.deepEqual(player.readingRange, originalRange);
  await player.clickDock("Resume");
  assert.equal(player.playbackActive, true);
  assert.equal(player.audios[0].plays, 2);
  assert.equal(player.audios.length, 1);
  assert.equal(player.requests.length, 1);
  player.render({ text: "Neuer Text." });
  assert.equal(player.dock(), undefined);
  assert.equal(player.readingRange, null);
  assert.equal(player.playbackActive, false);
  assert(player.button("Listen"));
});

test("floating controls support a loading pause and a foreground error retry", async (t) => {
  const firstResponse = deferred();
  const player = setup(t, {
    geometry: true,
    response: (_request, index) =>
      index === 1 ? firstResponse.promise : new Response("mp3"),
  });
  await player.ready();
  player.scrollControlsTo(-10);
  const starting = player.button("Listen").props.onClick();
  await player.settle();
  await player.clickDock("Pause");
  firstResponse.resolve(
    Response.json({ error: "Try the audio again" }, { status: 502 }),
  );
  await starting;
  await player.settle();
  assert.equal(player.playbackActive, false);
  await player.clickDock("Retry");
  assert.equal(player.playbackActive, true);
  assert.equal(player.audios.length, 1);
  assert.equal(player.requests.length, 2);
});

test("floating-control geometry observers clean up and revoked Premium removes the dock", async (t) => {
  const player = setup(t, { geometry: true });
  await player.ready();
  await player.click("Listen");
  player.scrollControlsTo(-10);
  assert(player.dock());
  player.render({ hasPremium: false });
  assert.equal(player.dock(), undefined);
  assert.equal(player.playbackActive, false);
  assert.equal(player.observedControlsDisconnected, true);
  assert.equal(player.pendingFrames, 0);
});

test("playback-active callback uses the latest handler and turns false on pause and unmount", async (t) => {
  const player = setup(t);
  const latestChanges = [];
  await player.ready();
  await player.click("Listen");
  assert.deepEqual(player.activeChanges, [true]);
  player.render({
    onPlaybackActiveChange: (active) => latestChanges.push(active),
  });
  await player.click("Pause");
  await player.click("Resume");
  player.unmount();
  assert.deepEqual(player.activeChanges, [true]);
  assert.deepEqual(latestChanges, [false, true, false]);
  assert.equal(player.requests.length, 1);
});

test("advancing into an unfinished lookahead shares its request and Pause retains the promoted foreground request", async (t) => {
  const pendingNext = deferred();
  const player = setup(t, {
    props: { text: "Eins. Zwei." },
    response: (_request, index) =>
      index === 2 ? pendingNext.promise : new Response("mp3"),
  });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  assert.deepEqual(player.readingRange, { start: 0, end: 5 });
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.requests.length, 2);
  assert.equal(player.readingRange, null);
  await player.click("Pause");
  assert.equal(player.requests[1].options.signal.aborted, false);
  pendingNext.resolve(new Response("next mp3"));
  await player.settle();
  assert.equal(player.readingRange, null);
  await player.click("Resume");
  assert.equal(player.requests.length, 2);
  assert.deepEqual(player.readingRange, { start: 6, end: 11 });
});

test("Pause aborts lookahead, Resume restarts it, and a late aborted result cannot replace or detach the new request", async (t) => {
  const oldPrefetch = deferred();
  const resumedPrefetch = deferred();
  const player = setup(t, {
    props: { text: "Eins. Zwei." },
    response: (_request, index) =>
      index === 2
        ? oldPrefetch.promise
        : index === 3
          ? resumedPrefetch.promise
          : new Response("mp3"),
  });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  await player.click("Pause");
  assert.equal(player.requests[0].options.signal.aborted, false);
  assert.equal(player.requests[1].options.signal.aborted, true);
  assert.deepEqual(player.readingRange, { start: 0, end: 5 });
  await player.click("Resume");
  assert.equal(player.requests.length, 3);
  oldPrefetch.resolve(new Response("stale lookahead"));
  await player.settle();
  assert.deepEqual(player.created, ["blob:reader-1"]);
  player.render({ text: "Neuer Text." });
  assert.equal(player.requests[2].options.signal.aborted, true);
  resumedPrefetch.resolve(new Response("also cancelled lookahead"));
  await player.settle();
  assert.deepEqual(player.created, ["blob:reader-1"]);
  assert.equal(player.readingRange, null);
});

test("failed prefetch does not interrupt the current sentence and becomes retryable only when reached", async (t) => {
  const player = setup(t, {
    props: { text: "Eins. Zwei." },
    response: (_request, index) =>
      index === 2
        ? Response.json({ error: "Next sentence failed" }, { status: 502 })
        : new Response("mp3"),
  });
  await player.ready();
  await player.click("Listen");
  assert.equal(player.requests.length, 2);
  assert.equal(player.audioCaches[0].size, 1);
  assert.doesNotMatch(text(player.render()), /Next sentence failed/);
  assert.deepEqual(player.readingRange, { start: 0, end: 5 });
  assert(player.button("Pause"));
  player.audios[0].onended();
  await player.settle();
  assert.match(text(player.render()), /Next sentence failed/);
  assert.equal(player.readingRange, null);
  assert.equal(player.requests.length, 2);
  await player.click("Retry");
  assert.equal(player.requests.length, 3);
  assert.deepEqual(player.readingRange, { start: 6, end: 11 });
});

for (const action of ["replace text", "unmount"]) {
  test(`${action} aborts unfinished lookahead and ignores its late audio`, async (t) => {
    const pendingNext = deferred();
    const player = setup(t, {
      props: { text: "Eins. Zwei." },
      response: (_request, index) =>
        index === 2 ? pendingNext.promise : new Response("mp3"),
    });
    await player.ready();
    await player.click("Listen");
    assert.equal(player.requests.length, 2);
    if (action === "replace text") player.render({ text: "Anderer Text." });
    else player.unmount();
    assert.equal(player.requests[1].options.signal.aborted, true);
    pendingNext.resolve(new Response("late lookahead"));
    if (action === "unmount") await nextTick();
    else await player.settle();
    assert.deepEqual(player.created, ["blob:reader-1"]);
    assert.equal(player.readingRange, null);
  });
}

test("unmount aborts pending audio and releases already generated object URLs", async (t) => {
  const pending = deferred();
  const player = setup(t, {
    props: { text: "Erster Satz. Zweiter Satz." },
    response: (_request, index) =>
      index === 1 ? new Response("mp3") : pending.promise,
  });
  await player.ready();
  player.setSpeed(2);
  await player.click("Listen");
  player.audios[0].onended();
  await player.settle();
  assert.equal(player.requests.length, 2);
  player.unmount();
  assert.equal(player.audioCaches[0].size, 0);
  assert.equal(player.readingRange, null);
  assert.equal(player.requests[1].options.signal.aborted, true);
  assert.equal(player.audios[0].src, "");
  assert.deepEqual(player.revoked, ["blob:reader-1"]);
  pending.resolve(new Response("late audio"));
  await nextTick();
  assert.equal(player.created.length, 1);
  assert.equal(player.audios[0].plays, 1);
  assert.equal(player.audioCaches[0].size, 0);
});
