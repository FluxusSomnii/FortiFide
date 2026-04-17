/**
 * Toggle src-tauri/Cargo.toml between the GPU and CPU build variants by
 * flipping the fortifide crate's `default` feature list.
 *
 *   default = ["gpu"]   ← GPU build (pulls whisper-rs/cuda) — DEFAULT
 *   default = ["cpu"]   ← CPU build (marker-only feature, no cuda dep)
 *
 * The `cpu` feature is a pure marker: it adds no dependencies. The real
 * variant switch is whether `gpu` (and therefore `whisper-rs/cuda`) is in
 * the default list. Writing `default = ["cpu"]` removes `gpu` from the
 * default, which is what actually produces the CPU build.
 *
 * GPU is the default as of Section 22.2 / build-default patch. Running
 * this script for `gpu` mode is now a no-op on a fresh checkout.
 *
 * Invoked by package.json scripts:
 *   node scripts/set-cargo-variant.mjs gpu
 *   node scripts/set-cargo-variant.mjs cpu
 *
 * With no argument, prints the current default and usage, exit 0.
 *
 * Idempotent — running twice in a row has the same effect as once.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cargoPath = resolve(__dirname, "..", "src-tauri", "Cargo.toml");

// Match the `default = [...]` line inside the [features] block. Must be an
// array so we can tell it's the feature default and not something else
// named "default" elsewhere in the toml. Multiline not expected.
const lineRe = /^default\s*=\s*\[[^\]]*\]\s*$/m;

const variant = process.argv[2];

// No argument → report current default and usage. Exit 0 so CI/setup
// scripts that inspect the current state don't have to branch on exit code.
if (!variant) {
  try {
    const src = readFileSync(cargoPath, "utf8");
    const match = src.match(lineRe);
    if (match) {
      const line = match[0].trim();
      let detected;
      if (line.includes('"gpu"')) detected = "gpu";
      else if (line.includes('"cpu"')) detected = "cpu";
      else if (line === "default = []") detected = "cpu (legacy empty default)";
      else detected = `unknown (${line})`;
      console.log(`[set-cargo-variant] Current: ${detected}`);
    } else {
      console.log("[set-cargo-variant] Current: no default line found");
    }
  } catch (err) {
    console.error(
      `[set-cargo-variant] Could not read ${cargoPath}: ${err?.message ?? err}`,
    );
  }
  console.log("Usage: node scripts/set-cargo-variant.mjs <gpu|cpu>");
  process.exit(0);
}

if (variant !== "gpu" && variant !== "cpu") {
  console.error("Usage: node scripts/set-cargo-variant.mjs <gpu|cpu>");
  process.exit(2);
}

const src = readFileSync(cargoPath, "utf8");
if (!lineRe.test(src)) {
  console.error(
    `[set-cargo-variant] Could not find "default = [...]" feature line in ${cargoPath}.\n` +
      `Expected a [features] block with a "default" entry.`,
  );
  process.exit(1);
}

const target = variant === "gpu" ? 'default = ["gpu"]' : 'default = ["cpu"]';
const current = src.match(lineRe)[0];
if (current === target) {
  console.log(`[set-cargo-variant] Cargo.toml already in ${variant} mode, no change`);
  process.exit(0);
}

writeFileSync(cargoPath, src.replace(lineRe, target));
console.log(`[set-cargo-variant] Switched Cargo.toml to ${variant} mode`);
