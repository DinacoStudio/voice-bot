"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Readable } = require("node:stream");
const { guardEdgeTTSStreams, readAudioStream } = require("../src/services/tts");

test("Edge guard ignores WebSocket frames for an unknown request", () => {
  let pushed = 0;
  const fake = {
    _streams: { known: {} },
    _pushAudioData() { pushed++; },
    _pushMetadata() { pushed++; },
  };
  guardEdgeTTSStreams(fake);
  fake._pushAudioData(Buffer.from("bad"), "unknown");
  fake._pushMetadata(Buffer.from("bad"), undefined);
  fake._pushAudioData(Buffer.from("ok"), "known");
  assert.equal(pushed, 1);
  assert.doesNotThrow(() => {
    fake._streams.unknown.turnEnded = true;
    fake._streams.unknown.audio.push(null);
  });
});

test("Edge stream errors are converted to a rejected promise", async () => {
  const stream = new Readable({ read() {} });
  const result = readAudioStream(stream, 1000);
  stream.destroy(new Error("socket failed"));
  await assert.rejects(result, /socket failed/);
});

test("Edge stream is fully buffered before playback", async () => {
  const stream = Readable.from([Buffer.from("one"), Buffer.from("two")]);
  assert.equal((await readAudioStream(stream)).toString(), "onetwo");
});
