"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { capabilityHint } from "@/components/services/capability-hint";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/hooks/use-capabilities";
import { formatBytes } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** Mirrors MAX_DROP_ARCHIVE_BYTES so the browser rejects before uploading. */
const MAX_BYTES = 256 * 1024 * 1024;

/**
 * Upload the zip a `drop` application deploys.
 *
 * Not a tRPC mutation: the payload is binary and can be hundreds of megabytes,
 * which the REST adapter's 1 MiB cap and superjson would both mangle. It posts
 * straight to the route handler with the session cookie.
 */
export function DropUpload({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const canWrite = can("service.write");

	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [lastUpload, setLastUpload] = useState<{ name: string; bytes: number } | null>(null);

	const upload = async (file: File) => {
		if (!file.name.toLowerCase().endsWith(".zip")) {
			toast.error("Pick a .zip archive");
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error(`Archive is larger than ${formatBytes(MAX_BYTES)}`);
			return;
		}
		setUploading(true);
		try {
			const response = await fetch(`/api/applications/${applicationId}/source`, {
				method: "POST",
				body: file,
				headers: { "content-type": "application/zip" },
			});
			const body = (await response.json().catch(() => null)) as { message?: string } | null;
			if (!response.ok) {
				toast.error(body?.message ?? "Upload failed");
				return;
			}
			setLastUpload({ name: file.name, bytes: file.size });
			toast.success("Archive uploaded — deploy to build it");
			// The readiness check reads whether the archive exists on disk.
			void queryClient.invalidateQueries({
				queryKey: trpc.application.one.queryKey({ applicationId }),
			});
		} catch {
			toast.error("Upload failed");
		} finally {
			setUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the drop zone wraps a real file input, which carries the semantics */}
			<div
				onDragOver={(event) => {
					event.preventDefault();
					if (canWrite) setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					if (!canWrite) return;
					const file = event.dataTransfer.files?.[0];
					if (file) void upload(file);
				}}
				className={cn(
					"flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-8 text-center text-sm transition-colors",
					dragging && "border-primary bg-primary/5",
				)}
			>
				<Upload className="size-6 text-muted-foreground" />
				<p className="text-muted-foreground">
					Drop a <span className="font-medium text-foreground">.zip</span> of your project here, or
				</p>
				<input
					id={inputId}
					ref={inputRef}
					type="file"
					accept=".zip,application/zip"
					className="sr-only"
					disabled={!canWrite || uploading}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) void upload(file);
					}}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!canWrite || uploading}
					title={canWrite ? undefined : capabilityHint("service.write")}
					onClick={() => inputRef.current?.click()}
				>
					{uploading ? <Loader2 className="size-4 animate-spin" /> : null}
					{uploading ? "Uploading…" : "Choose a file"}
				</Button>
				{lastUpload ? (
					<p className="text-muted-foreground">
						Uploaded {lastUpload.name} ({formatBytes(lastUpload.bytes)})
					</p>
				) : null}
			</div>
			<p className="text-sm text-muted-foreground">
				The archive is extracted into the application&apos;s code directory and built with the
				selected build type. Re-uploading replaces it; the next deploy builds whatever is there. You
				can also upload from CI with{" "}
				<code className="rounded bg-muted px-1">nixploy app upload &lt;id&gt; ./app.zip</code>.
			</p>
		</div>
	);
}
