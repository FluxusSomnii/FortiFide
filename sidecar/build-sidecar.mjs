/**
 * Build a standalone single-file executable of the Node sidecar
 * using Node's Single Executable Applications (SEA) feature.
 *
 * Pipeline:
 *   rhetorical-server.ts + workspace deps + npm deps
 *     → esbuild → single CJS bundle
 *     → `node --experimental-sea-config` → SEA blob
 *     → copy node.exe, strip Authenticode signature, inject blob via postject
 *     → src-tauri/binaries/fortifide-sidecar-<target-triple>.exe
 *
 * Tauri picks up the triple-suffixed binary via `bundle.externalBin`.
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = __dirname;
const appRoot = resolve(sidecarDir, "..");

// Output: Tauri externalBin convention — name must be `{basename}-{target-triple}{ext}`.
// For a Windows x64 MSVC build the triple is x86_64-pc-windows-msvc.
const TRIPLE = process.env.TAURI_TARGET_TRIPLE || "x86_64-pc-windows-msvc";
const BASENAME = "fortifide-sidecar";
const outDir = resolve(appRoot, "src-tauri/binaries");
const outExe = join(outDir, `${BASENAME}-${TRIPLE}.exe`);
mkdirSync(outDir, { recursive: true });

// Scratch directory for intermediate artefacts.
const workDir = join(sidecarDir, ".sea-build");
if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const bundlePath = join(workDir, "sidecar-bundle.cjs");
const blobPath = join(workDir, "sidecar.blob");
const seaConfigPath = join(workDir, "sea-config.json");
const entryPath = join(sidecarDir, "rhetorical-server.ts");

// ── 1. Bundle TS → single CJS ─────────────────────────────────────
console.log("[1/5] Bundling sidecar with esbuild…");
execSync(
  [
    "npx --yes esbuild@0.24.0",
    `"${entryPath}"`,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node22",
    "--legal-comments=none",
    `--outfile="${bundlePath}"`,
  ].join(" "),
  { stdio: "inherit", cwd: appRoot },
);
const bundleSize = statSync(bundlePath).size;
console.log(`      bundle: ${(bundleSize / 1024).toFixed(1)} KB`);

// ── 2. Write SEA config ───────────────────────────────────────────
console.log("[2/5] Writing SEA config…");
writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
    },
    null,
    2,
  ),
);

// ── 3. Generate SEA blob ──────────────────────────────────────────
console.log("[3/5] Generating SEA blob…");
execSync(`node --experimental-sea-config "${seaConfigPath}"`, {
  stdio: "inherit",
});

// ── 4. Copy node.exe and strip Authenticode signature ─────────────
console.log("[4/5] Copying node.exe and stripping signature…");
copyFileSync(process.execPath, outExe);

// signtool ships with the Windows 10 SDK. Required: postject cannot inject
// into a file with an Authenticode signature on Windows.
const signtoolCandidates = [
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe",
];
const signtool = signtoolCandidates.find((p) => existsSync(p));
if (signtool) {
  try {
    execSync(`"${signtool}" remove /s "${outExe}"`, { stdio: "inherit" });
  } catch {
    console.warn("      (signtool remove failed — may already be unsigned)");
  }
} else {
  console.warn(
    "      (signtool not found — postject may fail if exe is signed)",
  );
}

// ── 5. Inject blob via postject ───────────────────────────────────
console.log("[5/5] Injecting SEA blob via postject…");
execSync(
  [
    "npx --yes postject@1.0.0-alpha.6",
    `"${outExe}"`,
    "NODE_SEA_BLOB",
    `"${blobPath}"`,
    "--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ].join(" "),
  { stdio: "inherit" },
);

const outSize = statSync(outExe).size;
console.log(
  `\n✓ Built ${outExe}\n  size: ${(outSize / 1024 / 1024).toFixed(1)} MB`,
);
