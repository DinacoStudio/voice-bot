"use strict";

function preview(value, maxLength = 120) {
  if (typeof value !== "string") return String(value);
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}…` : oneLine;
}

function logSanitizerLoad() {
  const { SANITIZER_VERSION } = require("./sanitize");
  console.log(`[Sanitizer] active version=${SANITIZER_VERSION} module=${require.resolve("./sanitize")}`);
}

function logSanitizerDrop(route, diagnostics, rawText) {
  if (!diagnostics || diagnostics.reason === "ok") return;
  const details = [
    `route=${route}`,
    `reason=${diagnostics.reason}`,
    `version=${diagnostics.version}`,
    `module=${diagnostics.modulePath}`,
    `inputLength=${diagnostics.inputLength ?? (typeof rawText === "string" ? rawText.length : "n/a")}`,
    `cleanLength=${diagnostics.cleanLength ?? 0}`,
    `limit=${diagnostics.limit ?? "n/a"}`,
    `preview=${JSON.stringify(preview(rawText))}`,
  ];
  console.warn(`[Sanitizer Drop] ${details.join(" ")}`);
}

module.exports = { logSanitizerDrop, logSanitizerLoad };
