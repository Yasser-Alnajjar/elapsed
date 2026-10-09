import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the integration policies and counts load. */
export default function AdminIntegrationsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading integrations">
      <Skeleton className="h-16 w-full max-w-xl" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-40 w-full" />
      ))}
    </div>
  );
}
