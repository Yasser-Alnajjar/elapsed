import { Badge } from "@/components/ui/badge";
import { formatCommitmentStatus } from "@/lib/format";
import { commitmentStatusStyle } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "border-transparent text-nowrap",
        commitmentStatusStyle(status).chip,
      )}
    >
      {formatCommitmentStatus(status)}
    </Badge>
  );
}
