"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { sanitizeText } = require("../src/utils/sanitize");

test("keeps normal speech", () => {
  assert.equal(sanitizeText("Привет, как дела?"), "Привет, как дела?");
  assert.equal(sanitizeText("31/12/1999 и Hello, 日本語"), "31 12 1999 и Hello, 日本語");
});

test("removes Discord syntax, markdown, URLs and emoji", () => {
  const raw = "# **Привет** <@123> <:dance:456> 😀 [сайт](https://x.test) `code` ||мир||";
  assert.equal(sanitizeText(raw), "Привет сайт ссылка удалена мир");
  assert.equal(sanitizeText("😀 <:x:123> !!!"), "");
});

test("replaces URLs and long numbers with spoken placeholders", () => {
  assert.equal(
    sanitizeText("Заходи на https://example.com/test?id=123 и введи 123456789"),
    "Заходи на ссылка удалена и введи число",
  );
  assert.equal(sanitizeText("Код 12345, год 2026"), "Код 12345, год 2026");
  assert.equal(
    sanitizeText("[официальный сайт](https://example.com)"),
    "официальный сайт ссылка удалена",
  );
  assert.equal(
    sanitizeText("https://a.test https://b.test https://c.test https://d.test"),
    "ссылка удалена",
  );
  assert.equal(
    sanitizeText("Ссылки: https://a.test, https://b.test, https://c.test"),
    "Ссылки: ссылка удалена",
  );
});

test("removes invisible and unsafe symbols", () => {
  assert.equal(sanitizeText("при\u200Bвет @#$%^&*() мир"), "привет () мир");
});

test("silences repeat and keyboard spam", () => {
  assert.equal(sanitizeText("ахахахахахахахахах"), "");
  assert.equal(sanitizeText("да да да да да да"), "");
  assert.equal(sanitizeText("приветA01 приветB02 приветC03 приветD04 приветE05"), "");
  assert.equal(sanitizeText(".ghf;h.;fg.h;f.h;f.h;.f;s.;s.f;.sd;f.;sd.f.;sf.s;f.s;.f;.sf"), "");
});

test("real examples classify normal text and spam", () => {
  const dir = path.join(__dirname, "..", "examples");
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  for (const name of ["example.txt", "example3.txt", "example6.txt", "example11.txt", "example14.txt"]) {
    assert.notEqual(sanitizeText(read(name)), "", `${name} must remain readable`);
  }
  for (const name of ["example2.txt", "example4.txt", "example5.txt", "example7.txt", "example8.txt", "example9.txt", "example10.txt", "example12.txt", "example13.txt", "example15.txt", "example16.txt", "example17.txt", "example19.txt", "example20.txt", "example21.txt", "example22.txt", "example23.txt", "example24.txt"]) {
    assert.equal(sanitizeText(read(name)), "", `${name} must be silenced`);
  }
  assert.match(sanitizeText(read("example18.txt")), /^Вот та же последовательность/,
    "normal introduction in a mixed message must survive");
});

test("always observes the configured TTS limit", () => {
  const output = sanitizeText("Это вполне нормальное длинное предложение без спама и странных символов.", 35);
  assert.ok(output.length <= 35);
  assert.ok(output.endsWith("…"));
});

test("every command route imports the production sanitizer", () => {
  const sources = ["src/index.js", "src/commands/slashCommands.js", "src/commands/index.js"]
    .map((name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8"));
  for (const source of sources) {
    assert.match(source, /utils[\\/]sanitize/);
    assert.doesNotMatch(source, /tts-sanitizer/);
  }
});
