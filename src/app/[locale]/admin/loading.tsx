import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the Administration layout while a page's data loads, so a click answers at once. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4" aria-busy="true">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-4 pt-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
