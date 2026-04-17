/**
 * Visual tokens for the Guided Setup wizard.
 *
 * Mirrors the existing palette used by OnboardingModal and PythonVersionModal
 * so the wizard feels like the same surface, not a foreign widget. Anything
 * new here (step status colours, command-block monospace styling) is scoped
 * to the wizard; no upstream modals need to change.
 */
import type { CSSProperties } from "react";
import type { CheckStatus } from "./setupTypes";

// ── Palette ──────────────────────────────────────────────────────────────
export const COLORS = {
  bg: "#0c0c12",
  surface: "rgba(255,255,255,0.035)",
  surfaceElevated: "rgba(255,255,255,0.05)",
  surfaceAction: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.07)",
  borderElevated: "rgba(255,255,255,0.12)",
  text: "#e4e2dc",
  muted: "#8a8880",
  tertiary: "#46443f",
  accent: "#AFA9EC",
  accentSoft: "rgba(175,169,236,0.12)",
  accentStrong: "rgba(175,169,236,0.7)",
  ok: "#5DCAA5",
  warn: "#E0A57A",
  err: "#E07A7A",
  codeBg: "rgba(0,0,0,0.25)",
} as const;

// ── Typography ───────────────────────────────────────────────────────────
export const FONT_TITLE =
  "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
export const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_MONO = "'Courier New', Consolas, Menlo, monospace";

// ── Shared styles ────────────────────────────────────────────────────────
export const titleStyle: CSSProperties = {
  fontFamily: FONT_TITLE,
  fontSize: 28,
  fontWeight: 400,
  letterSpacing: "-0.01em",
  color: COLORS.text,
  margin: 0,
};
export const sectionHeadingStyle: CSSProperties = {
  fontFamily: FONT_TITLE,
  fontSize: 20,
  fontWeight: 400,
  letterSpacing: "-0.01em",
  color: COLORS.text,
  margin: 0,
};
export const bodyStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 14,
  lineHeight: 1.6,
  color: COLORS.text,
};
export const bodyMutedStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 15,
  lineHeight: 1.55,
  color: COLORS.muted,
};
export const smallStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 12,
  lineHeight: 1.5,
  color: COLORS.muted,
};
export const codeBlockStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  lineHeight: 1.5,
  color: COLORS.text,
  background: COLORS.codeBg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: "12px 14px",
  overflowX: "auto",
  whiteSpace: "pre",
  margin: 0,
};

// ── Status colour mapping ────────────────────────────────────────────────
export function statusColor(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return COLORS.ok;
    case "wrong_version":
      return COLORS.warn;
    case "missing":
      return COLORS.err;
    case "unknown":
      return COLORS.muted;
  }
}

export function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "missing":
      return "Missing";
    case "wrong_version":
      return "Needs attention";
    case "unknown":
      return "Not checked yet";
  }
}
