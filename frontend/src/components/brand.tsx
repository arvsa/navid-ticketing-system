// The Navid Schools logo. The artwork has a white background, so it always
// sits on a white tile, which also keeps it readable in the dark theme.
import type { CSSProperties } from "react";
import logo from "@/assets/navid-logo.png";
import { cx } from "./ui";

/** The butterfly from the sign-in page, in `currentColor`. Decoration only. */
export function Butterfly({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="-24 -24 48 48" className={className} style={style} aria-hidden>
      <g fill="currentColor">
        <path d="M0 -2C-6 -18 -22 -20 -20 -6C-19 2 -8 2 0 0Z" />
        <path d="M0 -2C6 -18 22 -20 20 -6C19 2 8 2 0 0Z" />
        <path d="M0 1C-5 4 -16 8 -12 16C-8 20 -2 10 0 3Z" opacity=".75" />
        <path d="M0 1C5 4 16 8 12 16C8 20 2 10 0 3Z" opacity=".75" />
        <rect x="-1" y="-6" width="2" height="16" rx="1" />
      </g>
    </svg>
  );
}

export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white ring-1 ring-black/5", className)}
      style={{ width: size, height: size }}
    >
      <img src={logo} alt="" className="size-full object-contain p-[3%]" draggable={false} />
    </span>
  );
}
