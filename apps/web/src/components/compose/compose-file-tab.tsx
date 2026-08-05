"use client";

import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

export function ComposeFileTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [value, setValue] = useState(compose.composeFile);
	useEffect(() => {
		setValue(compose.composeFile);
	}, [compose.composeFile]);

	const servicesQuery = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);

	const saveMutation = useMutation(
		trpc.compose.saveComposeFile.mutationOptions({
			onSuccess: () => {
				toast.success("Compose file saved");
				queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.compose.loadServices.queryKey({
						composeId: compose.composeId,
					}),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader className="flex-row items-center justify-between gap-4">
					<div>
						<CardTitle className="text-sm font-medium">Compose File</CardTitle>
						<CardDescription>
							{compose.sourceType === "raw"
								? "This file is stored directly on the service."
								: "Overwrites the compose file inside the local clone of the source."}
						</CardDescription>
					</div>
					<Button
						size="sm"
						disabled={saveMutation.isPending || value === compose.composeFile}
						onClick={() =>
							saveMutation.mutate({
								composeId: compose.composeId,
								composeFile: value,
							})
						}
					>
						{saveMutation.isPending ? "Saving…" : "Save"}
					</Button>
				</CardHeader>
				<CardContent>
					<div className="overflow-hidden rounded-lg border [&_.cm-editor]:min-h-[60vh] [&_.cm-editor]:text-sm">
						<CodeMirror
							value={value}
							onChange={setValue}
							extensions={[yaml()]}
							theme="dark"
							height="60vh"
							basicSetup={{ lineNumbers: true, foldGutter: true }}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Services</CardTitle>
					<CardDescription>
						Services defined by the compose file — used for domains and logs.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{servicesQuery.isLoading ? (
						<div className="flex flex-wrap gap-2">
							<Skeleton className="h-6 w-24" />
							<Skeleton className="h-6 w-24" />
						</div>
					) : servicesQuery.isError ? (
						<p className="text-sm text-muted-foreground">
							Could not load services — the compose file may not be available yet. Deploy once, or
							fix the compose file.
						</p>
					) : (servicesQuery.data ?? []).length === 0 ? (
						<p className="text-sm text-muted-foreground">No services found in the compose file.</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{(servicesQuery.data ?? []).map((serviceName) => (
								<Badge key={serviceName} variant="secondary">
									{serviceName}
								</Badge>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
