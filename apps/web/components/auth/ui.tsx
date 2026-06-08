import Link from "next/link";

/**
 * Shared presentational primitives for the researcher auth surfaces. Pure (no
 * hooks), so they render in both server pages and client forms. Mauve Quiet
 * tokens only — primary actions are mauve fill, never black; status is conveyed
 * by copy, not color.
 */

export const inputClass =
  "w-full rounded-lg border border-ink-200 bg-ink-0 px-4 py-2.5 font-ui text-body text-ink-800 placeholder:text-ink-400 transition-colors focus:border-ink-900 focus:outline-none disabled:opacity-50";

export const primaryBtnClass =
  "inline-flex h-11 w-full items-center justify-center rounded-lg bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50";

export const ghostBtnClass =
  "inline-flex h-11 w-full items-center justify-center rounded-lg border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-50";

export const linkClass =
  "font-ui text-body-sm text-ink-600 underline-offset-2 transition-colors hover:text-ink-900 hover:underline";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-mauve-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-decor text-body-lg text-ink-900">MerismV2</p>
          <p className="mt-1 font-ui text-caption uppercase tracking-wider text-ink-400">
            研究者工作台
          </p>
        </div>
        <div className="rounded-xl bg-ink-0 p-8 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-display-md font-semibold text-ink-900">{title}</h1>
      {subtitle ? (
        <p className="mt-1.5 font-ui text-body-sm leading-6 text-ink-400">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-ui text-body-sm text-ink-600">
      {children}
    </label>
  );
}

/** Monochrome status note (no red); icon-less, copy-driven per the design system. */
export function FormNote({ tone = "error", children }: { tone?: "error" | "info"; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-lg bg-mauve-50 px-3 py-2 font-ui text-body-sm text-ink-900"
          : "rounded-lg bg-mauve-50 px-3 py-2 font-ui text-body-sm text-ink-600"
      }
    >
      {children}
    </p>
  );
}

export function AuthFooterLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <p className="mt-6 text-center font-ui text-body-sm text-ink-400">
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    </p>
  );
}
