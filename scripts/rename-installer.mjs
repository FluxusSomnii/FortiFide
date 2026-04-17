/**
 * Rename the Tauri NSIS installer to include the build variant.
 *
 *   Forti Fide_0.1.0_x64-setup.exe
 *     → Forti Fide_0.1.0_x64-gpu-setup.exe   (when called with "gpu")
 *     → Forti Fide_0.1.0_x64-cpu-setup.exe   (when called with "cpu")
 *
 * If a previous renamed file exists for the same variant, it is replaced.
 * Silently no-ops if the original installer is missing (lets the script run
 * on dev/typecheck passes without crashing).
 */
import { renameSync, existsSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const variant = process.argv[2];
if (variant !== "gpu" && variant !== "cpu") {
  console.error("Usage: node scripts/rename-installer.mjs <gpu|cpu>");
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const nsisDir = resolve(
  __dirname,
  "..",
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const original = join(nsisDir, "Forti Fide_0.1.0_x64-setup.exe");
const destination = join(nsisDir, `Forti Fide_0.1.0_x64-${variant}-setup.exe`);

if (!existsSync(original)) {
  console.log(`[rename-installer] No installer found at ${original} — skipping rename`);
  process.exit(0);
}

if (existsSync(destination)) {
  // Overwrite so repeat builds produce a fresh artefact.
  rmSync(destination, { force: true });
}

renameSync(original, destination);
const size = statSync(destination).size;
console.log(
  `[rename-installer] ${variant.toUpperCase()} installer → ${destination} (${(size / 1024 / 1024).toFixed(1)} MB)`,
);
