import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/components/ui/cn";

/**
 * {component.sidebar} — docs/DESIGN.md §7 Navigation.
 * Dark chrome: 240px {colors.ink.base}, brand lockup, the single nav destination, then the
 * pinned {component.api-status-card}. Wrapped in `.on-rail` so globals.css swaps the focus ring
 * to {colors.focus.ring-dark}.
 *
 * The rail has exactly ONE destination (docs/DESIGN.md §7 {component.sidebar}): this product is
 * one screen, and a nav entry that leads nowhere is a promise it does not keep. The rail earns
 * its place by carrying identity and the live API status, not by navigating.
 */

/** The rail shows where the API lives, not the whole URL. */
function apiHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function Sidebar({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Navegação principal"
      className={cn("on-rail flex w-rail shrink-0 flex-col gap-1 bg-rail px-3 py-4", className)}
    >
      {/* {component.brand-lockup} — 30px tile; off the 4px scale, a literal of §7. */}
      <div className="flex items-center gap-2 p-2">
        <span
          aria-hidden="true"
          style={{ width: "30px", height: "30px" }}
          className="flex shrink-0 items-center justify-center rounded-sm bg-brand text-label font-semibold text-text"
        >
          P
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-label font-semibold text-rail-text">Prog7</span>
          <span className="truncate text-caption text-rail-muted">Audio Studio</span>
        </span>
      </div>

      {/* {component.nav-label} — the system renders exactly one of these. */}
      <span className="px-2 pt-4 pb-2 text-overline font-semibold text-rail-muted">ÁUDIO</span>

      {/* {component.nav-item-active}. Not a button and not a link: there is nowhere else to go,
          so an interactive role would lie to the keyboard and to the screen reader alike.
          3px left bar — a literal of §7 {size.accent-rail}, off the 4px scale. */}
      <span
        aria-current="page"
        style={{ borderLeftWidth: "3px" }}
        className="flex items-center gap-2 rounded-sm border-l border-l-brand bg-rail-raised p-2 text-left text-body font-medium text-rail-text"
      >
        <span aria-hidden="true" className="text-brand">
          ◎
        </span>
        <span className="min-w-0 truncate">Transcrever</span>
      </span>

      {/* Flexible spacer — the status card is pinned to the bottom of the rail (§7). */}
      <div className="flex-1" />

      {/* {component.api-status-card} */}
      <div className="flex flex-col gap-1 rounded-sm bg-rail-raised p-3">
        <span className="flex items-center gap-2 text-label text-rail-text">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />
          API online
        </span>
        <span className="truncate font-mono text-mono text-rail-muted">{apiHost(API_BASE_URL)}</span>
      </div>
    </nav>
  );
}
