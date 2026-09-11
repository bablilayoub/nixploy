import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function pageItems(current: number, total: number): Array<{ key: string; page: number | "..." }> {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => ({ key: `p-${i + 1}`, page: i + 1 }));
	}
	if (current <= 3) {
		return [
			{ key: "p-1", page: 1 },
			{ key: "p-2", page: 2 },
			{ key: "p-3", page: 3 },
			{ key: "p-4", page: 4 },
			{ key: "e-end", page: "..." },
			{ key: `p-${total}`, page: total },
		];
	}
	if (current >= total - 2) {
		return [
			{ key: "p-1", page: 1 },
			{ key: "e-start", page: "..." },
			{ key: `p-${total - 3}`, page: total - 3 },
			{ key: `p-${total - 2}`, page: total - 2 },
			{ key: `p-${total - 1}`, page: total - 1 },
			{ key: `p-${total}`, page: total },
		];
	}
	return [
		{ key: "p-1", page: 1 },
		{ key: "e-start", page: "..." },
		{ key: `p-${current - 1}`, page: current - 1 },
		{ key: `p-${current}`, page: current },
		{ key: `p-${current + 1}`, page: current + 1 },
		{ key: "e-end", page: "..." },
		{ key: `p-${total}`, page: total },
	];
}

type DataTablePaginationProps<TData> = {
	table: Table<TData>;
	className?: string;
};

export function DataTablePagination<TData>({ table, className }: DataTablePaginationProps<TData>) {
	const currentPage = table.getState().pagination.pageIndex + 1;
	const totalPages = Math.max(table.getPageCount(), 1);
	const items = pageItems(currentPage, totalPages);

	return (
		<div className={cn("flex flex-wrap items-center justify-between gap-4 px-2", className)}>
			<div className="flex items-center gap-2">
				<p className="text-sm text-muted-foreground">Rows per page</p>
				<Select
					value={`${table.getState().pagination.pageSize}`}
					onValueChange={(value) => table.setPageSize(Number(value))}
				>
					<SelectTrigger className="h-8 w-18">
						<SelectValue placeholder={table.getState().pagination.pageSize} />
					</SelectTrigger>
					<SelectContent side="top">
						{[10, 20, 30, 40, 50].map((pageSize) => (
							<SelectItem key={pageSize} value={`${pageSize}`}>
								{pageSize}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex items-center gap-2">
				<p className="text-sm font-medium tabular-nums">
					Page {currentPage} of {totalPages}
				</p>
				<div className="flex items-center gap-1">
					<Button
						variant="outline"
						size="icon-sm"
						className="hidden size-8 sm:inline-flex"
						onClick={() => table.setPageIndex(0)}
						disabled={!table.getCanPreviousPage()}
					>
						<span className="sr-only">First page</span>
						<ChevronsLeft className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						className="size-8"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
					>
						<span className="sr-only">Previous page</span>
						<ChevronLeft className="size-4" />
					</Button>
					{items.map((item) => {
						if (item.page === "...") {
							return (
								<span key={item.key} className="px-1 text-sm text-muted-foreground">
									…
								</span>
							);
						}
						const page = item.page;
						return (
							<Button
								key={item.key}
								variant={currentPage === page ? "default" : "outline"}
								size="icon-sm"
								className="size-8"
								aria-label={`Page ${page}`}
								aria-current={currentPage === page ? "page" : undefined}
								onClick={() => table.setPageIndex(page - 1)}
							>
								{page}
							</Button>
						);
					})}
					<Button
						variant="outline"
						size="icon-sm"
						className="size-8"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
					>
						<span className="sr-only">Next page</span>
						<ChevronRight className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						className="hidden size-8 sm:inline-flex"
						onClick={() => table.setPageIndex(table.getPageCount() - 1)}
						disabled={!table.getCanNextPage()}
					>
						<span className="sr-only">Last page</span>
						<ChevronsRight className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
