'use strict';

/**
 * Comprehensive test suite for tts-sanitizer.
 * Run with: node tests.js
 */

const { sanitizeText, cleanDiscordMarkup } = require('./index');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write('.');
  } else {
    failed++;
    failures.push(message);
    process.stdout.write('F');
  }
}

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  assert(ok, `${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

function assertIncludes(actual, substring, label) {
  const ok = typeof actual === 'string' && actual.includes(substring);
  assert(ok, `${label}\n  expected to include: ${JSON.stringify(substring)}\n  actual: ${JSON.stringify(actual)}`);
}

function assertNotIncludes(actual, substring, label) {
  const ok = typeof actual === 'string' && !actual.includes(substring);
  assert(ok, `${label}\n  expected NOT to include: ${JSON.stringify(substring)}\n  actual: ${JSON.stringify(actual)}`);
}

function assertShorterThan(actual, max, label) {
  const ok = typeof actual === 'string' && actual.length <= max;
  assert(ok, `${label}\n  length ${actual.length} > ${max}\n  actual: ${JSON.stringify(actual)}`);
}

function assertMatch(actual, regex, label) {
  const ok = typeof actual === 'string' && regex.test(actual);
  assert(ok, `${label}\n  expected to match ${regex}\n  actual: ${JSON.stringify(actual)}`);
}

console.log('Running tts-sanitizer tests\n');

// ─────────────────────────────────────────────────────────────
// 1. Basic / normal messages
// ─────────────────────────────────────────────────────────────
assertEqual(sanitizeText('Привет, как дела?'), 'Привет, как дела?', 'normal russian');
assertEqual(sanitizeText('Hello, how are you?'), 'Hello, how are you?', 'normal english');
assertEqual(sanitizeText('  много   пробелов   '), 'много пробелов', 'collapse spaces');
assertEqual(sanitizeText(''), '', 'empty string');
assertEqual(sanitizeText(null), '', 'null');
assertEqual(sanitizeText(undefined), '', 'undefined');
assertEqual(sanitizeText(123), '', 'non-string');

// ─────────────────────────────────────────────────────────────
// 2. Discord markup
// ─────────────────────────────────────────────────────────────
assertEqual(
  sanitizeText('```js\nconsole.log(1)\n``` обычный текст'),
  'обычный текст',
  'code block removed'
);

assertEqual(
  sanitizeText('посмотри `code` здесь'),
  'посмотри здесь',
  'inline code removed'
);

assertEqual(
  sanitizeText('[Google](https://google.com) и текст'),
  'Google и текст',
  'markdown link keeps label'
);

assertNotIncludes(
  sanitizeText('зайди https://example.com/path?x=1 сейчас'),
  'https',
  'bare URL removed'
);

assertNotIncludes(
  sanitizeText('<@123456789> привет'),
  '<@',
  'user mention removed'
);

assertNotIncludes(
  sanitizeText('<@!123456789> привет'),
  '<@!',
  'nickname mention removed'
);

assertNotIncludes(
  sanitizeText('<@&987654321> роль'),
  '<@&',
  'role mention removed'
);

assertNotIncludes(
  sanitizeText('зайди в <#555> канал'),
  '<#',
  'channel mention removed'
);

assertNotIncludes(
  sanitizeText('время <t:1690000000:R>'),
  '<t:',
  'timestamp removed'
);

assertEqual(
  sanitizeText('смайл <:smile:123456> ок'),
  'смайл smile ок',
  'custom emoji → name'
);

assertEqual(
  sanitizeText('анимированный <a:wave:999> привет'),
  'анимированный wave привет',
  'animated emoji → name'
);

// Unicode emoji should be stripped
assertNotIncludes(
  sanitizeText('привет 😀🎉🚀 мир'),
  '😀',
  'unicode emoji removed'
);

// ─────────────────────────────────────────────────────────────
// 3. Character repeats
// ─────────────────────────────────────────────────────────────
assertEqual(sanitizeText('ссссссссссссссссер'), 'ссер', 'long consonant run collapsed');
// collapseCharRepeats keeps at most 2 identical chars in a row
assertEqual(sanitizeText('привееееееееет'), 'привеет', 'long vowel run collapsed to max 2');
assertMatch(sanitizeText('привееееееееет'), /^приве+т$/, 'привет with many е becomes short');

// After global char-collapse, pure "аааа…" becomes "аа" (max 2 repeats)
assertEqual(sanitizeText('аааааааааааааааааааааааа'), 'аа', 'pure a-spam collapsed to aa');
assertShorterThan(sanitizeText('аааааааааааааааааааааааа'), 4, 'pure a-spam is tiny');

// ─────────────────────────────────────────────────────────────
// 4. Syllable / digram repeats
// ─────────────────────────────────────────────────────────────
const ahah = sanitizeText('ахахахахахахахахах');
assertMatch(ahah, /^ахах/, 'syllable ahah collapsed');
assertShorterThan(ahah, 10, 'syllable result short');

const lol = sanitizeText('lolololololololol');
assertMatch(lol, /^lolo/i, 'syllable lol collapsed');
assertShorterThan(lol, 8, 'syllable lol is short');

// ─────────────────────────────────────────────────────────────
// 5. Identical word runs
// ─────────────────────────────────────────────────────────────
assertEqual(sanitizeText('да да да да да да'), 'да…', 'identical "да" run');
assertEqual(sanitizeText('yes yes yes yes yes'), 'yes…', 'identical "yes" run');
assertEqual(sanitizeText('нет нет нет'), 'нет нет нет', 'three is not enough to collapse');

// ─────────────────────────────────────────────────────────────
// 6. Common prefix spam (приветA01 …)
// ─────────────────────────────────────────────────────────────
const prefixSpam = sanitizeText(
  'приветA01 приветB02 приветC03 приветD04 приветE05'
);
assertMatch(prefixSpam, /^привет/i, 'common prefix starts with привет');
assertMatch(prefixSpam, /…$/, 'common prefix ends with ellipsis');
assertShorterThan(prefixSpam, 15, 'common prefix is short');

// Long mass-prefix spam (60+ variants) must collapse to a single token
const longPrefixSpam = sanitizeText(
  'приветA01 приветB02 приветC03 приветD04 приветE05 приветF06 приветG07 приветH08 приветI09 приветJ10 приветK11 приветL12 приветM13 приветN14 приветO15 приветP16 приветQ17 приветR18 приветS19 приветT20 приветU21 приветV22 приветW23 приветX24 приветY25 приветZ26 приветA27 приветB28 приветC29 приветD30 приветE31 приветF32 приветG33 приветH34 приветI35 приветJ36 приветK37 приветL38 приветM39 приветN40 приветO41 приветP42 приветQ43 приветR44 приветS45 приветT46 приветU47 приветV48 приветW49 приветX50 приветY51 приветZ52 приветA53 приветB54 приветC55 приветD56 приветE57 приветF58 приветG59 приветH60 приветI61 приветJ62 приветK63 приветL64 приветM65 приветN66 приветO67'
);
assertEqual(longPrefixSpam, 'привет…', 'long mass prefix spam fully collapsed');
assertShorterThan(longPrefixSpam, 10, 'long mass prefix is tiny');

const helloSpam = sanitizeText(
  'hello1 hello2 hello3 hello4 hello5 hello6'
);
assertMatch(helloSpam, /^hello/i, 'latin common prefix starts with hello');
assertMatch(helloSpam, /…$/, 'latin common prefix ends with ellipsis');

// ─────────────────────────────────────────────────────────────
// 7. Ladder patterns
// ─────────────────────────────────────────────────────────────
const ladder = sanitizeText('сер ссер сссер ссссер сссссер');
assertMatch(ladder, /^сер/i, 'ladder starts with сер');
assertMatch(ladder, /…$/, 'ladder ends with ellipsis');
assertShorterThan(ladder, 12, 'ladder is short');

// ─────────────────────────────────────────────────────────────
// 8. Near-duplicates (hello / helloo / hellooo)
// ─────────────────────────────────────────────────────────────
const near = sanitizeText('hello helloo hellooo helloooo hellooooo');
assertMatch(near, /^hello…?$/i, 'near-duplicate hello collapsed');

// ─────────────────────────────────────────────────────────────
// 9. Long words
// ─────────────────────────────────────────────────────────────
const longWord = 'ж' + 'о'.repeat(40);
const longResult = sanitizeText(longWord);
assertShorterThan(longResult, 10, 'absurdly long word collapsed');
assertEqual(longResult, 'жоо', 'long repeated vowel word becomes жоо');

// ─────────────────────────────────────────────────────────────
// 10. Low entropy / random garbage
// ─────────────────────────────────────────────────────────────
const abSpam = sanitizeText('абабабабабабабабабабабабаб');
assertShorterThan(abSpam, 20, 'ababab low entropy shortened');

// Keyboard-mash / gibberish must be silenced or heavily cut
const gib1 = sanitizeText(
  '.ghf;h.;fg.h;f.h;f.h;.f;s.;s.f;.sd;f.;sd.f.;sf.s;f.s;.f;.sf;.;.e.r;ew.r.;w;r.2;.r;.23;4.;2.4;23.;.rfse;.f.sh;g.rtfh.rthh.er;.h;ht.;4;rth;.th;h;t.;jtyu;.jkt;j.t;.;yt.j;t.;.5;6.7;56.7;5'
);
assertShorterThan(gib1, 12, 'punct keyboard mash silenced/short');

const gib2 = sanitizeText(
  'hn sfiuysdhfshd hsduif husdh uisfdhv usdu vhsuidv udsiv husdv hsd vshduiv husdh vsdvh sdh vsuidh vsdv ;sd,v ls, s;, s,d; vlsd, vls v,slv, sdl,v lsd,l, ,l 1,1l ,1l, 1l,1 l1l ,l 2l2,2,l'
);
assertShorterThan(gib2, 12, 'random consonant soup silenced/short');

const gib3 = sanitizeText(
  '.;.;.j;g.;j.g;.j;.g;hj.g;j.g.j;gh.jgh.j;.g;j.;g.j;gh.jg;h.j;gh.j;g.j.;ghj;g.j;gh.j;.;rt.y;rt.y;rt.y;rt.y;r.;y.rty.r;.yr;.yr;t.yr;t.yr;y.rt;y.r;y;rt.y;r.ytr;.y;r.t;.er;.te;rt.e;.te;.t;e.t;e.rt;e.ter'
);
assertShorterThan(gib3, 12, 'dot-semicolon mash silenced/short');

const randomish = sanitizeText('qwertyqwertyqwertyqwertyqwerty');
assertShorterThan(randomish.length > 0 ? randomish : 'x', 40, 'repeated pattern shortened or cleaned');

// ─────────────────────────────────────────────────────────────
// 11. Mixed scripts & Unicode
// ─────────────────────────────────────────────────────────────
assertEqual(
  sanitizeText('Привет Hello 世界'),
  'Привет Hello 世界',
  'mixed scripts kept when normal'
);

// ─────────────────────────────────────────────────────────────
// 12. Digits and noisy tokens
// ─────────────────────────────────────────────────────────────
const noisy = sanitizeText('abc001 abc002 abc003 abc004 abc005');
assertMatch(noisy, /abc/i, 'pattern with digits still recognized');
assertShorterThan(noisy, 15, 'digit pattern spam collapsed');

// ─────────────────────────────────────────────────────────────
// 13. Max length
// ─────────────────────────────────────────────────────────────
const longMsg = 'слово '.repeat(100);
const limited = sanitizeText(longMsg, 50);
assertShorterThan(limited, 55, 'maxLength respected');
assertMatch(limited, /…$/, 'truncated message ends with ellipsis');

// ─────────────────────────────────────────────────────────────
// 14. Only punctuation → empty
// ─────────────────────────────────────────────────────────────
assertEqual(sanitizeText('!!! ??? ...'), '', 'only punctuation becomes empty');
assertEqual(sanitizeText('😀😀😀'), '', 'only emoji becomes empty');

// ─────────────────────────────────────────────────────────────
// 15. cleanDiscordMarkup isolation
// ─────────────────────────────────────────────────────────────
assertEqual(
  cleanDiscordMarkup('текст `code` и https://x.com'),
  'текст и',
  'cleanDiscordMarkup basic'
);

// ─────────────────────────────────────────────────────────────
// 16. Real-world-ish spam mixtures
// ─────────────────────────────────────────────────────────────
const mixed = sanitizeText(
  '<@111> приветA01 приветB02 приветC03 😀 https://spam.gg сссссер ахахахахах да да да да да'
);
assertNotIncludes(mixed, '<@', 'mixed: mention gone');
assertNotIncludes(mixed, 'https', 'mixed: url gone');
assertNotIncludes(mixed, '😀', 'mixed: emoji gone');
assertShorterThan(mixed, 80, 'mixed spam heavily reduced');

// ─────────────────────────────────────────────────────────────
// 17. Preservation of meaningful short repeats
// ─────────────────────────────────────────────────────────────
assertEqual(
  sanitizeText('нет нет'),
  'нет нет',
  'two identical words are kept'
);

assertEqual(
  sanitizeText('очень очень важно'),
  'очень очень важно',
  'normal repetition kept'
);

// ─────────────────────────────────────────────────────────────
// 18. Case insensitivity of detectors
// ─────────────────────────────────────────────────────────────
const caseSpam = sanitizeText('HELLO hello HeLLo HELLO hello');
assertMatch(caseSpam, /^hello…?$/i, 'case-insensitive identical run');

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
console.log('\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log('─'.repeat(50));
    console.log(f);
  }
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
  process.exit(0);
}
