import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";

const code = ts.transpileModule(
  readFileSync(
    new URL("../src/components/ui/SourceAudioButton.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

function setup(t, { play = async () => {} } = {}) {
  const hooks = [];
  const cleanups = [];
  const audios = [];
  const revoked = [];
  let cursor = 0;
  let requests = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, (value) => (hooks[index].value = value)];
    },
    useRef(current) {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useCallback(callback) {
      cursor++;
      return callback;
    },
    useEffect(effect) {
      const index = cursor++;
      if (!hooks[index]) {
        hooks[index] = {};
        cleanups.push(effect());
      }
    },
  };
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response("audio", {
      headers: { "Content-Type": "audio/mpeg" },
    });
  });
  t.mock.method(URL, "createObjectURL", () => `blob:audio-${requests}`);
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class {
    constructor(url) {
      this.src = url;
      this.plays = 0;
      this.pauses = 0;
      audios.push(this);
    }
    play() {
      this.plays++;
      return play();
    }
    pause() {
      this.pauses++;
    }
  };
  t.after(() => {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  });
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") {
      const jsx = (type, props) => ({ type, props });
      return { jsx, jsxs: jsx };
    }
    if (name.endsWith(".module.css")) return { default: {} };
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return {
    audios,
    revoked,
    get requests() {
      return requests;
    },
    render() {
      cursor = 0;
      const tree = exports.SourceAudioButton({
        text: "der Apfel",
        sourceLanguage: "de",
      });
      return tree.props.children[0];
    },
    cleanup() {
      cleanups.forEach((cleanup) => cleanup?.());
    },
  };
}

test("replay uses cached audio after playback ends", async (t) => {
  const player = setup(t);
  await player.render().props.onClick();
  player.audios[0].onended();
  await player.render().props.onClick();
  assert.equal(player.requests, 1);
  assert.equal(
    player.audios.reduce((sum, audio) => sum + audio.plays, 0),
    2,
  );
});

test("a stalled playback start does not leave the button disabled", async (t) => {
  let finishPlaying;
  const playing = new Promise((resolve) => (finishPlaying = resolve));
  const player = setup(t, { play: () => playing });
  const firstPlay = player.render().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(player.render().props.disabled, false);
  } finally {
    finishPlaying();
    await firstPlay;
  }
});

test("a media failure allows a fresh request on retry", async (t) => {
  const player = setup(t);
  await player.render().props.onClick();
  player.audios[0].onerror();
  await player.render().props.onClick();
  assert.equal(player.requests, 2);
  assert.ok(player.revoked.includes("blob:audio-1"));
});

test("blocked playback retains generated audio for a direct retry", async (t) => {
  let attempts = 0;
  const player = setup(t, {
    play: async () => {
      if (++attempts === 1) {
        throw new DOMException(
          "Playback requires a user gesture",
          "NotAllowedError",
        );
      }
    },
  });
  await player.render().props.onClick();
  assert.equal(player.render().props.disabled, false);
  await player.render().props.onClick();
  assert.equal(player.requests, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(player.revoked, []);
  assert.equal(player.render().props["aria-label"], "Replay AI pronunciation");
});

test("an interrupted old playback cannot discard a successful replay", async (t) => {
  let rejectFirst;
  let attempts = 0;
  const firstPlayback = new Promise((_, reject) => (rejectFirst = reject));
  const player = setup(t, {
    play: () => (++attempts === 1 ? firstPlayback : Promise.resolve()),
  });
  const firstPlay = player.render().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  await player.render().props.onClick();
  const replayAudio = player.audios[1];
  rejectFirst(new DOMException("Playback was interrupted", "AbortError"));
  await firstPlay;
  const button = player.render();
  assert.equal(player.requests, 1);
  assert.equal(replayAudio.plays, 1);
  assert.equal(replayAudio.pauses, 0);
  assert.deepEqual(player.revoked, []);
  assert.equal(button.props.disabled, false);
  assert.equal(button.props["aria-label"], "Replay AI pronunciation");
});

test("cleanup discards the revoked audio before the next playback", async (t) => {
  const player = setup(t);
  await player.render().props.onClick();
  player.cleanup();
  await player.render().props.onClick();
  assert.equal(player.requests, 2);
  assert.equal(player.audios.length, 2);
  assert.ok(player.audios[0].pauses > 0);
});
