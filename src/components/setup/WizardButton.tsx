/**
 * Shared button component for the wizard. Three variants:
 *   primary   — accent-coloured, used for "Install X" / "Save" / "Launch"
 *   secondary — neutral border, used for "Re-check" / "Retry"
 *   ghost     — no border, used for "Skip setup" / "View docs" links
 *
 * Buttons that open external URLs should be given `external` so we can add
 * the "opens in external browser" hint to the aria-label.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { COLORS, FONT_BODY } from "./setupStyles";

interface Props {
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  children: ReactNode;
  /** Set for buttons that open a URL in the system browser. */
  external?: boolean;
  ariaLabel?: string;
  /** Full width in its container. */
  block?: boolean;
  /** Optional adjustments to the computed base style. */
  style?: CSSProperties;
}

export function WizardButton({
  variant = "secondary",
  disabled,
  onClick,
  type = "button",
  children,
  external,
  ariaLabel,
  block,
  style,
}: Props) {
  const [hover, setHover] = useState(false);

  const base: CSSProperties = {
    fontFamily: FONT_BODY,
    fontSize: 13,
    padding: "9px 16px",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    background: "transparent",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    width: block ? "100%" : "auto",
    lineHeight: 1.3,
  };

  let variantStyle: CSSProperties;
  switch (variant) {
    case "primary":
      variantStyle = {
        border: `1px solid ${hover && !disabled ? COLORS.accentStrong : "rgba(175,169,236,0.4)"}`,
        color: COLORS.accent,
      };
      break;
    case "secondary":
      variantStyle = {
        border: `1px solid ${hover && !disabled ? COLORS.borderElevated : COLORS.border}`,
        color: COLORS.text,
      };
      break;
    case "ghost":
      variantStyle = {
        border: "1px solid transparent",
        color: COLORS.muted,
        padding: "6px 8px",
        textDecoration: hover && !disabled ? "underline" : "none",
        textUnderlineOffset: 2,
      };
      break;
  }

  const suffix = external ? " (opens in external browser)" : "";
  const computedAria = ariaLabel
    ? `${ariaLabel}${suffix}`
    : external
      ? `${typeof children === "string" ? children : "Open link"} (opens in external browser)`
      : undefined;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-label={computedAria}
      style={{ ...base, ...variantStyle, ...style }}
    >
      {children}
    </button>
  );
}
