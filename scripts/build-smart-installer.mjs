/**
 * Smart-installer build orchestrator.
 *
 * Expects both the GPU and CPU installers to already exist at
 * src-tauri/target/release/bundle/nsis/ (i.e. `pnpm build:gpu` and
 * `pnpm build:cpu` have both been run). Invokes makensis on
 * scripts/smart-installer.nsi, pointing INPUT_DIR at the bundle folder,
 * and produces:
 *
 *   src-tauri/target/release/bundle/nsis/Forti Fide_0.1.0_x64-setup.exe
 *
 * That's the single file a user downloads — picks the right variant at
 * install time based on CUDA detection.
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const nsisDir = resolve(appRoot, "src-tauri", "target", "release", "bundle", "nsis");
const nsiScript = resolve(__dirname, "smart-installer.nsi");
const outputFile = "Forti Fide_0.1.0_x64-setup.exe";

const gpuInstaller = join(nsisDir, "Forti Fide_0.1.0_x64-gpu-setup.exe");
const cpuInstaller = join(nsisDir, "Forti Fide_0.1.0_x64-cpu-setup.exe");

function fail(msg) {
  console.error(`[smart-installer] ${msg}`);
  process.exit(1);
}

// ── Preconditions ────────────────────────────────────────────────
if (!existsSync(gpuInstaller)) fail(`Missing GPU installer: ${gpuInstaller}\nRun: pnpm build:gpu`);
if (!existsSync(cpuInstaller)) fail(`Missing CPU installer: ${cpuInstaller}\nRun: pnpm build:cpu`);

// ── Locate makensis ──────────────────────────────────────────────
const candidates = [
  join(homedir(), "AppData", "Local", "tauri", "NSIS", "Bin", "makensis.exe"),
  join(homedir(), "AppData", "Local", "tauri", "NSIS", "makensis.exe"),
  "C:\\Program Files (x86)\\NSIS\\Bin\\makensis.exe",
  "C:\\Program Files\\NSIS\\Bin\\makensis.exe",
];
const makensis = candidates.find((p) => existsSync(p));
if (!makensis) {
  fail(
    "Could not find makensis.exe. Expected one of:\n  - " +
      candidates.join("\n  - ") +
      "\nTauri downloads NSIS on first build — make sure `pnpm build:gpu` has been run at least once.",
  );
}

console.log(`[smart-installer] makensis: ${makensis}`);
console.log(`[smart-installer] GPU input: ${gpuInstaller} (${(statSync(gpuInstaller).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[smart-installer] CPU input: ${cpuInstaller} (${(statSync(cpuInstaller).size / 1024 / 1024).toFixed(1)} MB)`);

// ── Compile ──────────────────────────────────────────────────────
// /V3 = verbose but not excessive. /DINPUT_DIR points the .nsi at the
// folder containing the two inner installers. /DOUTPUT_FILE sets the
// final name. Both .nsi and output live in nsisDir so the relative
// File paths resolve correctly and the output lands alongside the
// single-variant installers.
const args = [
  "/V3",
  `/DINPUT_DIR=${nsisDir}`,
  `/DOUTPUT_FILE=${outputFile}`,
  nsiScript,
];

// Every arg that contains a space or '=' gets quoted; makensis accepts both
// `/D NAME=value` with spaces-in-value as long as the whole token is quoted.
const cmd = [
  `"${makensis}"`,
  ...args.map((a) => (a.includes(" ") || a.includes("=") ? `"${a}"` : a)),
].join(" ");

try {
  execSync(cmd, { stdio: "inherit", cwd: nsisDir });
} catch (e) {
  fail(`makensis failed: ${e.message}`);
}

const finalOut = join(nsisDir, outputFile);
if (!existsSync(finalOut)) {
  fail(`makensis reported success but output file is missing: ${finalOut}`);
}

const finalSizeMb = statSync(finalOut).size / 1024 / 1024;
console.log(`\n[smart-installer] ✓ Built ${finalOut}`);
console.log(`[smart-installer]   size: ${finalSizeMb.toFixed(1)} MB`);
