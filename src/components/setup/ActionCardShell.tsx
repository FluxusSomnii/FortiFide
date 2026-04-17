/**
 * Bordered surface that every action card sits inside. Keeps the visual
 * language consistent without repeating the style block in seven places.
 */
import type { CSSProperties, ReactNode } from "react";
import { COLORS } from "./setupStyles";

interface Props {
  children: ReactNode;
  /** Optional label used for screen readers on the surrounding region. */
  ariaLabel?: string;
}

export function ActionCardShell({ children, ariaLabel }: Props) {
  const style: CSSProperties = {
    background: COLORS.surfaceAction,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };
  return (
    <section aria-label={ariaLabel} style={style}>
      {children}
    </section>
  );
}
