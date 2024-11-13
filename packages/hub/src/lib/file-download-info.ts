import { HUB_URL } from "../consts";
import { createApiError, InvalidApiResponseFormatError } from "../error";
import type { CredentialsParams, RepoDesignation } from "../types/public";
import { checkCredentials } from "../utils/checkCredentials";
import { toRepoId } from "../utils/toRepoId";

const HUGGINGFACE_HEADER_X_REPO_COMMIT = "X-Repo-Commit"
const HUGGINGFACE_HEADER_X_LINKED_ETAG = "X-Linked-Etag"
const HUGGINGFACE_HEADER_X_LINKED_SIZE = "X-Linked-Size"

export interface FileDownloadInfoOutput {
	size: number;
	etag: string;
	/**
	 * In case of LFS file, link to download directly from cloud provider
	 */
	downloadLink: string | null;
	commit_hash: string | null;
}
/**
 * @returns null when the file doesn't exist
 */
export async function fileDownloadInfo(
	params: {
		repo: RepoDesignation;
		path: string;
		revision?: string;
		hubUrl?: string;
		/**
		 * Custom fetch function to use instead of the default one, for example to use a proxy or edit headers.
		 */
		fetch?: typeof fetch;
		/**
		 * To get the raw pointer file behind a LFS file
		 */
		raw?: boolean;
		/**
		 * To avoid the content-disposition header in the `downloadLink` for LFS files
		 *
		 * So that on browsers you can use the URL in an iframe for example
		 */
		noContentDisposition?: boolean;
	} & Partial<CredentialsParams>
): Promise<FileDownloadInfoOutput | null> {
	const accessToken = checkCredentials(params);
	const repoId = toRepoId(params.repo);

	const hubUrl = params.hubUrl ?? HUB_URL;
	const url =
		`${hubUrl}/${repoId.type === "model" ? "" : `${repoId.type}s/`}${repoId.name}/${
			params.raw ? "raw" : "resolve"
		}/${encodeURIComponent(params.revision ?? "main")}/${params.path}` +
		(params.noContentDisposition ? "?noContentDisposition=1" : "");

	const resp = await (params.fetch ?? fetch)(url, {
		method: "HEAD",
		headers: {
			...(params.credentials && {
				Authorization: `Bearer ${accessToken}`,
			}),
		},
		redirect: 'manual',
	});

	if (resp.status === 404 && resp.headers.get("X-Error-Code") === "EntryNotFound") {
		return null;
	}

	// redirect is okay
	if (!resp.ok && !resp.headers.get('Location')) {
		throw await createApiError(resp);
	}

	const etag = resp.headers.get(HUGGINGFACE_HEADER_X_LINKED_ETAG) ?? resp.headers.get("ETag");
	if (!etag) {
		throw new InvalidApiResponseFormatError("Expected ETag");
	}

	// Content-Length vs Content-Range
	// See https://stackoverflow.com/questions/716680/difference-between-content-range-and-range-headers
	const contentSize = resp.headers.get(HUGGINGFACE_HEADER_X_LINKED_SIZE) ?? resp.headers.get("Content-Length")

	if (!contentSize) {
		throw new InvalidApiResponseFormatError("Expected size information");
	}

	const size = parseInt(contentSize);

	if (isNaN(size)) {
		throw new InvalidApiResponseFormatError("Invalid file size received");
	}

	return {
		etag,
		size,
		downloadLink: new URL(resp.url).hostname !== new URL(hubUrl).hostname ? resp.url : null,
		commit_hash: resp.headers.get(HUGGINGFACE_HEADER_X_REPO_COMMIT),
	};
}
