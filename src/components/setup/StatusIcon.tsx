/**
 * 24px circle indicating a check's current status.
 *
 * Animates colour + 0.95→1.0 scale for 200ms when `status` flips, so a
 * re-check that turns a step green is perceivably different from the page
 * re-rendering at rest.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CheckStatus } from "./setupTypes";
import { COLORS, statusColor } from "./setupStyles";

interface Props {
  status: CheckStatus;
  /** Accessibility label; usually "<step name> — <status label>". */
  ariaLabel: string;
  /** 24px by default; list rows pass 22–24, success screen larger. */
  size?: number;
}

export function StatusIcon({ status, ariaLabel, size = 24 }: Props) {
  const prev = useRef(status);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prev.current !== status) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 220);
      prev.current = status;
      return () => clearTimeout(t);
    }
    return;
  }, [status]);

  const colour = statusColor(status);
  const isUnknown = status === "unknown";

  const circleStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: isUnknown ? "transparent" : colour,
    border: isUnknown ? `1.5px solid ${COLORS.tertiary}` : "none",
    color: isUnknown ? COLORS.muted : "#0c0c12",
    transform: pulse ? "scale(0.95)" : "scale(1)",
    transition:
      "background 220ms ease, border-color 220ms ease, transform 220ms ease",
  };

  const glyph = (() => {
    switch (status) {
      case "ok":
        return (
          <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "missing":
        return (
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        );
      case "wrong_version":
        return (
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 3v6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="8" cy="12" r="1" fill="currentColor" />
          </svg>
        );
      case "unknown":
        return (
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 8h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        );
    }
  })();

  return (
    <span role="img" aria-label={ariaLabel} style={circleStyle}>
      {glyph}
    </span>
  );
}
