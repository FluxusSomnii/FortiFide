import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

/**
 * Dismissible notice shown when CUDA is unavailable on a GPU-build install.
 *
 * Truth table:
 *   build = gpu, cuda_available = true  → no banner (happy path)
 *   build = gpu, cuda_available = false → banner: "CUDA not detected, install
 *                                           CUDA or use the CPU build"
 *   build = cpu                         → no banner (user chose CPU)
 *
 * Once dismissed, the choice is remembered via localStorage and the banner
 * never reappears. The Rust side caches the probe, so remounts are cheap.
 */

const DISMISS_KEY = "fortifide.cudaBanner.dismissed";
const CUDA_URL = "https://developer.nvidia.com/cuda-downloads";

const BG = "rgba(175,169,236,0.06)";
const BORDER = "rgba(175,169,236,0.25)";
const ACCENT = "#AFA9EC";
const TEXT = "#e4e2dc";
const MUTED = "rgba(228,226,220,0.55)";

interface CudaStatus {
  build_variant: "gpu" | "cpu";
  cuda_available: boolean;
}

export function CpuModeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Respect previous dismissal.
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "true") {
        return;
      }
    } catch {
      return;
    }

    let cancelled = false;
    invoke<CudaStatus>("get_cuda_status")
      .then((s) => {
        if (cancelled) return;
        // Only the GPU build with CUDA-unavailable shows the banner. The CPU
        // build never shows it (the user chose CPU; nagging them to install
        // CUDA would be wrong).
        if (s.build_variant === "gpu" && !s.cuda_available) setVisible(true);
      })
      .catch((e) => {
        // If the command itself fails, stay silent. The probe is best-effort
        // and other error surfaces will catch actual CUDA failures at load.
        console.error("[CUDA-BANNER] get_cuda_status failed:", e);
      });
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch (e) {
      console.error("[CUDA-BANNER] Failed to persist dismissal:", e);
    }
    setVisible(false);
  };

  const openCudaDownloads = async () => {
    try {
      await shellOpen(CUDA_URL);
    } catch (e) {
      console.error("[CUDA-BANNER] shell.open failed:", e);
    }
  };

  const containerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "9px 14px",
    background: BG,
    borderBottom: `1px solid ${BORDER}`,
    color: TEXT,
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  };

  const dotStyle: CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: ACCENT,
    flexShrink: 0,
  };

  const linkStyle: CSSProperties = {
    color: ACCENT,
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
  };

  const dismissStyle: CSSProperties = {
    marginLeft: "auto",
    background: "transparent",
    border: "none",
    color: MUTED,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "2px 6px",
    borderRadius: 3,
    flexShrink: 0,
  };

  return (
    <div role="status" aria-live="polite" style={containerStyle}>
      <span aria-hidden style={dotStyle} />
      <span>
        CUDA not detected. Running in CPU mode — transcription will be
        significantly slower. For best performance, install the{" "}
        <button type="button" onClick={openCudaDownloads} style={linkStyle}>
          CUDA Toolkit
        </button>
        . Or download the CPU-optimised build from the releases page.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss CUDA notice"
        style={dismissStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = TEXT)}
        onMouseLeave={(e) => (e.currentTarget.style.color = MUTED)}
      >
        Dismiss
      </button>
    </div>
  );
}
