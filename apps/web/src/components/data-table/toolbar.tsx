"use client";

import type { Table } from "@tanstack/react-table";
import { Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DataTableToolbarProps<TData> = {
	table: Table<TData>;
	filterColumn?: string;
	filterPlaceholder?: string;
	className?: string;
	children?: React.ReactNode;
};

export function DataTableToolbar<TData>({
	table,
	filterColumn = "name",
	filterPlaceholder = "Filter…",
	className,
	children,
}: DataTableToolbarProps<TData>) {
	const column = table.getColumn(filterColumn);
	const isFiltered = table.getState().columnFilters.length > 0;

	return (
		<div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
			<div className="flex flex-1 flex-wrap items-center gap-2">
				{column ? (
					<Input
						placeholder={filterPlaceholder}
						value={(column.getFilterValue() as string) ?? ""}
						onChange={(event) => column.setFilterValue(event.target.value)}
						className="h-8 w-[150px] lg:w-[250px]"
					/>
				) : null}
				{children}
				{isFiltered ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => table.resetColumnFilters()}
						className="h-8 px-2"
					>
						Reset
						<X className="size-4" />
					</Button>
				) : null}
			</div>
			<DataTableViewOptions table={table} />
		</div>
	);
}

function DataTableViewOptions<TData>({ table }: { table: Table<TData> }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" className="ms-auto h-8">
					<Settings2 className="size-4" />
					View
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{table
					.getAllColumns()
					.filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
					.map((column) => (
						<DropdownMenuCheckboxItem
							key={column.id}
							className="capitalize"
							checked={column.getIsVisible()}
							onCheckedChange={(value) => column.toggleVisibility(!!value)}
						>
							{column.id}
						</DropdownMenuCheckboxItem>
					))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
