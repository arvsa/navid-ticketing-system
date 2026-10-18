// Basic building blocks, styled with the design tokens.
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";
import { errorMessage } from "@/lib/labels";

/** Joins classes; later Tailwind classes override earlier conflicting ones. */
export const cx = (...v: ClassValue[]) => twMerge(clsx(v));

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "ghost-danger" | "danger" | "success" | "dark" | "link";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors duration-[var(--dur-1)] disabled:opacity-60",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-[15px]",
        size === "lg" && "h-12 px-6 text-[16px]",
        variant === "primary" && "bg-primary text-on-primary hover:bg-primary-hover",
        variant === "secondary" && "bg-sunken text-text hover:bg-border",
        variant === "ghost" && "text-text-2 hover:bg-sunken",
        variant === "ghost-danger" && "text-danger hover:bg-danger-soft",
        variant === "danger" && "bg-danger-solid text-white hover:opacity-90",
        variant === "success" && "bg-success-solid text-white hover:opacity-90",
        variant === "dark" && "bg-text text-surface hover:opacity-90",
        variant === "link" && "h-auto px-0 text-primary hover:underline",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-[22px] bg-surface shadow-1 ring-1 ring-border", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cx("text-[13px] font-semibold tracking-[0.08em] text-text-3 uppercase", className)}>
      {children}
    </h2>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-[34px] font-bold tracking-tight break-anywhere sm:text-[34px] sm:leading-[40px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-md text-text-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = (error as { requestId?: string } | null)?.requestId;
  const code = (error as { code?: string } | null)?.code;
  if (code === "not_found") {
    return (
      <EmptyState title="You don't have access to this, or it no longer exists.">
        <a href="/" className="text-primary hover:underline">
          Go to Home
        </a>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
      <p className="font-semibold">We couldn't load this.</p>
      <p className="text-text-2">{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
      {requestId && <p className="text-[12px] text-text-3">Request {requestId}</p>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-semibold">
        {label}
        {optional && <span className="font-normal text-text-3"> (optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] text-text-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[12px] border border-input bg-surface px-3.5 py-2.5 text-text placeholder:text-text-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-sunken";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="modal-overlay fixed inset-0 z-[60] bg-[rgb(15_18_28/0.45)] backdrop-blur-[2px]" />
        <RDialog.Content
          onPointerDownOutside={keepOpenForToasts}
          onInteractOutside={keepOpenForToasts}
          className={cx(
            "modal-content z-[70]",
            "fixed top-1/2 left-1/2 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[20px] bg-surface shadow-3",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RDialog.Title className="text-[18px] font-bold">{title}</RDialog.Title>
              {description && (
                <RDialog.Description className="mt-1 text-text-2">{description}</RDialog.Description>
              )}
            </div>
            <RDialog.Close className="rounded-md p-1 text-text-3 hover:bg-sunken" aria-label="Close">
              <X className="size-5" />
            </RDialog.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Clicking a toast must not close the dialog underneath it. */
function keepOpenForToasts(e: { target: EventTarget | null; preventDefault: () => void }) {
  if ((e.target as HTMLElement | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
}

/** A large centred modal (bottom sheet on phones) for detail views: reviewing
 * work, a person, a new item. Same API as before, when it was a side drawer. */
export function Drawer({
  open,
  onOpenChange,
  children,
  label,
  size = "lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  label: string;
  size?: "md" | "lg" | "xl";
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="modal-overlay fixed inset-0 z-40 bg-[rgb(15_18_28/0.45)] backdrop-blur-[2px]" />
        <RDialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={keepOpenForToasts}
          onInteractOutside={keepOpenForToasts}
          className={cx(
            "modal-content fixed z-50 flex flex-col overflow-hidden bg-surface shadow-3",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[22px]",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[86vh] sm:w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]",
            size === "md" && "sm:max-w-[560px]",
            size === "lg" && "sm:max-w-[720px]",
            size === "xl" && "sm:max-w-[920px]",
          )}
        >
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
export const DrawerClose = RDialog.Close;

export function Menu({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          sideOffset={6}
          className="z-[80] min-w-[220px] rounded-[10px] border border-border bg-surface p-1 shadow-2"
        >
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken",
        danger && "text-danger",
      )}
    >
      {children}
    </RMenu.Item>
  );
}

export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <RMenu.Label className="px-3 py-1.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">{children}</RMenu.Label>
);

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; count?: number | null; badge?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cx("max-w-full overflow-x-auto scrollbar-none", className)}>
      <div role="tablist" className="inline-flex gap-1 rounded-full bg-sunken p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cx(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] whitespace-nowrap transition-colors",
              value === t.value ? "bg-surface font-semibold text-text shadow-1" : "text-text-2 hover:text-text",
            )}
          >
            {t.label}
            {t.count != null &&
              (t.badge ? (
                <span className="rounded-full bg-warning-soft px-1.5 text-[12px] font-semibold text-warning tabular">{t.count}</span>
              ) : (
                <span className="text-[13px] text-text-3 tabular">{t.count}</span>
              ))}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-sunken p-1 scrollbar-none">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "shrink-0 rounded-full px-3.5 whitespace-nowrap transition-colors",
            size === "sm" ? "h-7 text-[13px]" : "h-8 text-[14px]",
            value === o.value ? "bg-surface font-semibold text-text shadow-1" : "text-text-2 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-8 w-[60px] shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-border-strong",
      )}
    >
      <span
        className={cx(
          "absolute top-1 size-6 rounded-full bg-white shadow transition-[left] duration-[var(--dur-2)]",
          checked ? "left-[32px]" : "left-1",
        )}
      />
    </button>
  );
}

export function Chip({
  active,
  children,
  onClick,
  tone,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "h-9 shrink-0 rounded-full border px-4 text-[15px] font-medium whitespace-nowrap transition-colors",
        active ? "border-text bg-text text-surface" : "border-border bg-surface hover:bg-sunken",
      )}
      style={!active && tone ? { color: tone } : undefined}
    >
      {children}
    </button>
  );
}
