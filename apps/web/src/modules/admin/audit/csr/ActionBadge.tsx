import { Eye, FileSliders, Gauge, Pause, Play, RefreshCw, type LucideIcon } from "lucide-react";
import { Tag } from "@/components/admin/admin-ui";
import { ADMIN_AUDIT_ACTION_LABELS, type AdminAuditAction } from "@/lib/types/admin";

const PRESENTATION: Record<AdminAuditAction, { tone: "neutral" | "primary" | "success" | "warning"; icon: LucideIcon }> = {
  view_tenant: { tone: "neutral", icon: Eye },
  update_plan: { tone: "primary", icon: FileSliders },
  pause_polling: { tone: "warning", icon: Pause },
  resume_polling: { tone: "success", icon: Play },
  request_renormalize: { tone: "primary", icon: RefreshCw },
  update_worker_settings: { tone: "warning", icon: Gauge },
};

/** Quiet outline for a view, a tint for a real change, so changes stand out in a long list. */
export function ActionBadge({ action }: { action: string }) {
  const known = PRESENTATION[action as AdminAuditAction];
  const Icon = known?.icon;
  return (
    <Tag tone={known?.tone ?? "neutral"} className={known?.tone === "neutral" ? "bg-transparent" : undefined}>
      {Icon && <Icon className="size-3" aria-hidden />}
      {ADMIN_AUDIT_ACTION_LABELS[action as AdminAuditAction] ?? action}
    </Tag>
  );
}
