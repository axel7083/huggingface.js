import { HUB_URL } from "../consts";
import { createApiError } from "../error";
import type { CredentialsParams, RepoDesignation } from "../types/public";
import { checkCredentials } from "../utils/checkCredentials";
import { toRepoId } from "../utils/toRepoId";
import { getHFHubCache, getRepoFolderName } from "./cache-management";
import { dirname, join } from "node:path";
import { lstat, mkdir, stat } from "node:fs/promises";
import { fileDownloadInfo, type FileDownloadInfoOutput } from "./file-download-info";
import { writeFile, rename, symlink } from "node:fs/promises";

export const REGEX_COMMIT_HASH: RegExp = new RegExp("^[0-9a-f]{40}$");

function getFilePointer(storageFolder: string, revision: string, relativeFilename: string): string {
	const snapshotPath = join(storageFolder, "snapshots");
	return join(snapshotPath, revision, relativeFilename);
}

async function exists(path: string, followSymlinks?: boolean): Promise<boolean> {
	try {
		if(followSymlinks) {
			await stat(path);
		} else {
			await lstat(path);
		}
		return true;
	} catch (err: unknown) {
		return false;
	}
}

export async function downloadFileToCacheDir(
	params: {
		repo: RepoDesignation;
		path: string;
		/**
		 * If true, will download the raw git file.
		 *
		 * For example, when calling on a file stored with Git LFS, the pointer file will be downloaded instead.
		 */
		raw?: boolean;
		/**
		 * An optional Git revision id which can be a branch name, a tag, or a commit hash.
		 *
		 * @default "main"
		 */
		revision?: string;
		/**
		 * Fetch only a specific part of the file
		 */
		range?: [number, number];
		hubUrl?: string;
		cacheDir?: string,
		/**
		 * Custom fetch function to use instead of the default one, for example to use a proxy or edit headers.
		 */
		fetch?: typeof fetch;
	} & Partial<CredentialsParams>
): Promise<string> {
	// get revision provided or default to main
	const revision = params.revision ?? "main";
	const cacheDir = params.cacheDir ?? getHFHubCache();
	// get repo id
	const repoId = toRepoId(params.repo);
	// get storage folder
	const storageFolder = join(cacheDir, getRepoFolderName(repoId));

	const pointerPath = getFilePointer(storageFolder, revision, params.path)

	// if user provides a commitHash as revision, and they already have the file on disk, shortcut everything.
	if(REGEX_COMMIT_HASH.test(revision)) {
		if(await exists(pointerPath)) return pointerPath;
	}

	const downloadInfo: FileDownloadInfoOutput | null = await fileDownloadInfo({
		...params,
		revision: revision,
	});
	if(!downloadInfo) throw new Error(`cannot get download info for ${params.path}`);

	let downloadLink: string;
	if(downloadInfo.downloadLink && !params.raw) {
		downloadLink = downloadInfo.downloadLink;
	} else {
		downloadLink = `${params.hubUrl ?? HUB_URL}/${repoId.type === "model" ? "" : `${repoId.type}s/`}${repoId.name}/${
			params.raw ? "raw" : "resolve"
		}/${encodeURIComponent(revision)}/${params.path}`;
	}

	// weird reasons the etag is under the format "...." with quotes
	const etag = downloadInfo.etag.replaceAll("\"", "");

	const blobPath = join(storageFolder, "blobs", etag);

	// mkdir blob and pointer path parent directory
	await mkdir(dirname(blobPath), { recursive: true });
	await mkdir(dirname(pointerPath), { recursive: true });

	// TODO: _cache_commit_hash_for_specific_revision

	const incomplete = `${blobPath}.incomplete`;
	await downloadToFile({
		...params,
		url: downloadLink,
		destinationPath: incomplete,
	});

	await rename(incomplete, blobPath);
	await symlink(blobPath, pointerPath);
	return blobPath;
}

export async function downloadToFile(params: {
	url: string,
	destinationPath: string,
} & Partial<CredentialsParams>): Promise<void> {
	const accessToken = checkCredentials(params);
	const resp = await fetch(params.url, {
		headers: (accessToken
			? {
				Authorization: `Bearer ${accessToken}`,
			}
			: {}),
	});

	if (resp.status === 404 && resp.headers.get("X-Error-Code") === "EntryNotFound") {
		throw await createApiError(resp);
	}

	if (!resp.ok || !resp.body) throw new Error('invalid response')

	// @ts-expect-error resp.body is a Stream, but Stream in internal to node
	return writeFile(params.destinationPath, resp.body);
}

/**
 * @returns null when the file doesn't exist
 */
export async function downloadFile(
	params: {
		repo: RepoDesignation;
		path: string;
		/**
		 * If true, will download the raw git file.
		 *
		 * For example, when calling on a file stored with Git LFS, the pointer file will be downloaded instead.
		 */
		raw?: boolean;
		/**
		 * An optional Git revision id which can be a branch name, a tag, or a commit hash.
		 *
		 * @default "main"
		 */
		revision?: string;
		/**
		 * Fetch only a specific part of the file
		 */
		range?: [number, number];
		hubUrl?: string;
		cacheDir?: string,
		/**
		 * Custom fetch function to use instead of the default one, for example to use a proxy or edit headers.
		 */
		fetch?: typeof fetch;
	} & Partial<CredentialsParams>
): Promise<Response | null> {

	// get revision provided or default to main
	const revision = params.revision ?? "main";
	const cacheDir = params.cacheDir ?? getHFHubCache();

	const accessToken = checkCredentials(params);
	const repoId = toRepoId(params.repo);
	const url = `${params.hubUrl ?? HUB_URL}/${repoId.type === "model" ? "" : `${repoId.type}s/`}${repoId.name}/${
		params.raw ? "raw" : "resolve"
	}/${encodeURIComponent(revision)}/${params.path}`;

	const resp = await (params.fetch ?? fetch)(url, {
		headers: {
			...(accessToken
				? {
						Authorization: `Bearer ${accessToken}`,
				  }
				: {}),
			...(params.range
				? {
						Range: `bytes=${params.range[0]}-${params.range[1]}`,
				  }
				: {}),
		},
	});

	// get storage folder
	const storageFolder = join(cacheDir, getRepoFolderName(repoId));

	if (resp.status === 404 && resp.headers.get("X-Error-Code") === "EntryNotFound") {
		return null;
	} else if (!resp.ok) {
		throw await createApiError(resp);
	}

	return resp;
}
