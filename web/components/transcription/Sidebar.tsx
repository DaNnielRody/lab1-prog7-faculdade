import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/components/ui/cn";

function apiHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface SidebarProps {
  /**
   * Whether the client's last request to the API succeeded. The card reports *our last attempt* —
   * there is no health endpoint and none is implied, which is why the unreachable copy is
   * "sem resposta" and not "offline".
   */
  apiReachable?: boolean;
  className?: string;
}

export function Sidebar({ apiReachable = true, className }: SidebarProps) {
  return (
    <nav
      aria-label="Navegação principal"
      className={cn("on-rail flex w-rail shrink-0 flex-col gap-1 bg-rail px-3 py-4", className)}
    >
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
      <span className="px-2 pt-4 pb-2 text-overline font-semibold text-rail-muted">ÁUDIO</span>
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
      <div className="flex-1" />
      <div className="flex flex-col gap-1 rounded-sm bg-rail-raised p-3">
        <span className="flex items-center gap-2 text-label text-rail-text">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              apiReachable ? "bg-success" : "bg-rail-muted",
            )}
          />
          {apiReachable ? "API online" : "API sem resposta"}
        </span>
        <span className="truncate font-mono text-mono text-rail-muted">{apiHost(API_BASE_URL)}</span>
      </div>
    </nav>
  );
}
