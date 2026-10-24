import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FILE_CHUNK,
	type FileMeta,
	fileChunks,
	fileKeyOf,
	newFileKey,
	openFileChunk,
	openFileMeta,
	sealFileChunk,
	sealFileMeta,
	toBase64,
} from "@vauly/crypto";
import { useMemo } from "react";

import { client } from "@/utils/orpc";

import { useKeyring } from "./keyring";
import { fileRows } from "./offline";
import { type Item, useItemQueryOptions } from "./vault-data";

// Files attached to items. Each is encrypted here, a chunk at a time, with a key of its
// own that's sealed with the item key along with its name; the server keeps ciphertext
// and sizes. See packages/crypto, "Files".

/** A file as this device sees it: decrypted name and key, and what the server says. */
export type ItemFile = {
	id: string;
	itemId: string;
	name: string;
	type: string;
	size: number;
	chunks: number;
	key: CryptoKey;
	createdBy: string;
	createdAt: Date;
};

/** The files on every item the person can open, or on one item, by name. */
export function useFiles(itemId?: string) {
	const keyring = useKeyring();
	const queryClient = useQueryClient();
	const itemOptions = useItemQueryOptions();
	return useQuery({
		queryKey: ["vault", "files", keyring.epoch],
		enabled: keyring.status === "unlocked",
		networkMode: "always",
		queryFn: async (): Promise<ItemFile[]> => {
			const [items, rows] = await Promise.all([
				queryClient.fetchQuery(itemOptions),
				fileRows(),
			]);
			const keys = new Map(items.map((item) => [item.id, item.key]));
			const files = await Promise.all(
				rows.map(async (row): Promise<ItemFile | null> => {
					const itemKey = keys.get(row.itemId);
					if (!itemKey) return null;
					try {
						const meta = await openFileMeta(
							itemKey,
							row.id,
							row.itemId,
							row.meta,
						);
						return {
							id: row.id,
							itemId: row.itemId,
							name: meta.name,
							type: meta.type,
							size: meta.size,
							chunks: meta.chunks,
							key: await fileKeyOf(meta),
							createdBy: row.createdBy,
							createdAt: new Date(row.createdAt),
						};
					} catch {
						// Not one this version can open: leave it be rather than fail the list.
						return null;
					}
				}),
			);
			return files
				.filter((file) => file !== null)
				.sort((a, b) => a.name.localeCompare(b.name));
		},
		select: itemId
			? (files: ItemFile[]) => files.filter((file) => file.itemId === itemId)
			: undefined,
	});
}

/** What files take on this vauly, and its limits, in bytes. */
export function useFileUsage(enabled = true) {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "files", "usage"],
		enabled: enabled && status === "unlocked",
		queryFn: () => client.files.usage(),
	});
}

/** "1.2 MB", "340 KB", "12 bytes". */
export function fileSize(bytes: number) {
	if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	const mb = bytes / (1024 * 1024);
	return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

const metaOf = async (
	key: CryptoKey,
	file: { name: string; type: string; size: number },
): Promise<FileMeta> => ({
	v: 1,
	name: file.name,
	type: file.type,
	size: file.size,
	chunks: fileChunks(file.size),
	key: toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
});

/** Sends a chunk, once more if the first try fails on the way. */
async function put(id: string, index: number, data: string) {
	try {
		await client.files.put({ id, index, data });
	} catch {
		await client.files.put({ id, index, data });
	}
}

/**
 * Encrypts and uploads a file to an item. Only a chunk is in memory at a time.
 * `onProgress` gets the share sent so far, from 0 to 1.
 */
export async function uploadFile(
	item: Pick<Item, "id" | "key">,
	file: Blob & { name: string },
	onProgress?: (done: number) => void,
) {
	const chunks = fileChunks(file.size);
	const { id } = await client.files.create({
		itemId: item.id,
		size: file.size,
		chunks,
	});
	try {
		const key = await newFileKey();
		for (let index = 0; index < chunks; index++) {
			const part = new Uint8Array(
				await file
					.slice(index * FILE_CHUNK, (index + 1) * FILE_CHUNK)
					.arrayBuffer(),
			);
			await put(id, index, await sealFileChunk(key, id, index, chunks, part));
			onProgress?.((index + 1) / chunks);
		}
		const meta = await metaOf(key, {
			name: file.name,
			type: file.type,
			size: file.size,
		});
		await client.files.finish({
			id,
			meta: await sealFileMeta(item.key, id, item.id, meta),
		});
	} catch (error) {
		// Free the room the upload took; the server clears it after a day otherwise.
		await client.files.cancel({ id }).catch(() => {});
		throw error;
	}
	return id;
}

/** Downloads and decrypts a file. The server logs the download. */
export async function readFile(file: ItemFile) {
	const parts: BlobPart[] = [];
	for (let index = 0; index < file.chunks; index++) {
		const { data } = await client.files.get({ id: file.id, index });
		parts.push(
			await openFileChunk(file.key, file.id, index, file.chunks, data),
		);
	}
	// Never the type the file claims: the browser should save it, not open it.
	return new Blob(parts, { type: "application/octet-stream" });
}

/** Hands the browser a file to save. */
export function saveBlob(name: string, blob: Blob) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useFileActions() {
	const queryClient = useQueryClient();
	return useMemo(() => {
		const refresh = () =>
			queryClient.invalidateQueries({ queryKey: ["vault"] });
		return {
			async upload(
				item: Pick<Item, "id" | "key">,
				file: File,
				onProgress?: (done: number) => void,
			) {
				try {
					return await uploadFile(item, file, onProgress);
				} finally {
					await refresh();
				}
			},
			async download(file: ItemFile) {
				saveBlob(file.name, await readFile(file));
				await queryClient.invalidateQueries({
					queryKey: ["vault", "events"],
				});
			},
			/** A new name is a new seal; the contents don't move. */
			async rename(
				file: ItemFile,
				item: Pick<Item, "id" | "key">,
				name: string,
			) {
				const meta = await metaOf(file.key, { ...file, name });
				await client.files.rename({
					id: file.id,
					meta: await sealFileMeta(item.key, file.id, item.id, meta),
				});
				await refresh();
			},
			async remove(file: ItemFile) {
				await client.files.remove({ id: file.id });
				await refresh();
			},
		};
	}, [queryClient]);
}

/**
 * What a person approving an agent is shown of an item's files: how many, and the newest
 * one's date. The grant covers those, and none finished after.
 */
export function filesSeen(files: ItemFile[] | undefined) {
	const list = files ?? [];
	return {
		count: list.length,
		through: list.length
			? Math.max(...list.map((file) => file.createdAt.getTime()))
			: null,
	};
}

export type FilesSeen = ReturnType<typeof filesSeen>;
