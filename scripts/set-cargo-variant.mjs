/**
 * Toggle src-tauri/Cargo.toml between the GPU and CPU build variants by
 * flipping the fortifide crate's `default` feature list.
 *
 *   default = ["gpu"]   ← GPU build (pulls whisper-rs/cuda)
 *   default = []        ← CPU build
 *
 * Invoked by package.json scripts:
 *   node scripts/set-cargo-variant.mjs gpu
 *   node scripts/set-cargo-variant.mjs cpu
 *
 * Idempotent — running twice in a row has the same effect as once.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const variant = process.argv[2];
if (variant !== "gpu" && variant !== "cpu") {
  console.error("Usage: node scripts/set-cargo-variant.mjs <gpu|cpu>");
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const cargoPath = resolve(__dirname, "..", "src-tauri", "Cargo.toml");
const src = readFileSync(cargoPath, "utf8");

// Match the `default = [...]` line inside the [features] block.
// Must be an array so we can tell it's the feature default and not something
// else named "default" elsewhere in the toml. Multiline not expected.
const lineRe = /^default\s*=\s*\[[^\]]*\]\s*$/m;
if (!lineRe.test(src)) {
  console.error(
    `[set-cargo-variant] Could not find "default = [...]" feature line in ${cargoPath}.\n` +
      `Expected a [features] block with a "default" entry.`,
  );
  process.exit(1);
}

const target = variant === "gpu" ? 'default = ["gpu"]' : "default = []";
const current = src.match(lineRe)[0];
if (current === target) {
  console.log(`[set-cargo-variant] Cargo.toml already in ${variant} mode, no change`);
  process.exit(0);
}

writeFileSync(cargoPath, src.replace(lineRe, target));
console.log(`[set-cargo-variant] Switched Cargo.toml to ${variant} mode`);
