import { Skeleton } from "@/components/ui/skeleton";

/** Route-level fallback while a dashboard segment's server work resolves. */
export default function DashboardLoading() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-4 w-72" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{["a", "b", "c"].map((id) => (
					<Skeleton key={id} className="h-28 w-full rounded-lg" />
				))}
			</div>
			<Skeleton className="h-64 w-full rounded-lg" />
		</div>
	);
}
