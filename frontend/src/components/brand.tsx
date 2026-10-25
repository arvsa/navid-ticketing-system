// The Navid Schools logo. The artwork has a white background, so it always
// sits on a white tile, which also keeps it readable in the dark theme.
import logo from "@/assets/navid-logo.png";
import { cx } from "./ui";

export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white ring-1 ring-black/5", className)}
      style={{ width: size, height: size }}
    >
      <img src={logo} alt="" className="size-full object-contain p-[6%]" draggable={false} />
    </span>
  );
}
