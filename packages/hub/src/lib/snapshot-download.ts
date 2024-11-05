import type { RepoDesignation } from "../types/public";
import { listFiles } from "./list-files";
import { downloadFile } from "./download-file";
import { getHFHubCache } from "./cache-management";
import { spaceInfo } from "./space-info";
import { datasetInfo } from "./dataset-info";
import { modelInfo } from "./model-info";
import { toRepoId } from "../utils/toRepoId";

export async function snapshotDownload(
	params: {
		repo: RepoDesignation;
		cacheDir?: string,
		/**
		 * An optional Git revision id which can be a branch name, a tag, or a commit hash.
		 *
		 * @default "main"
		 */
		revision?: string;
		hubUrl?: string;
		/**
		 * Custom fetch function to use instead of the default one, for example to use a proxy or edit headers.
		 */
		fetch?: typeof fetch;
	},
): Promise<void> {

	let cacheDir: string;
	if(params.cacheDir) {
		cacheDir = params.cacheDir;
	} else {
		cacheDir = getHFHubCache();
	}

	const repoId = toRepoId(params.repo);

	// get repository revision value (sha)
	let repoInfo: { sha: string };
	switch (repoId.type) {
		case "space":
			repoInfo = await spaceInfo({
				name: repoId.name,
				additionalFields: ['sha'],
				revision: params.revision,
			});
			break;
		case "dataset":
			repoInfo = await datasetInfo({
				name: repoId.name,
				additionalFields: ['sha'],
				revision: params.revision,
			});
			break;
		case "model":
			repoInfo = await modelInfo({
				name: repoId.name,
				additionalFields: ['sha'],
				revision: params.revision,
			});
			break;
		default:
			throw new Error(`invalid repository type ${repoId.type}`);
	}

	const cursor = listFiles({
		repo: params.repo,
		recursive: true,
		revision: repoInfo.sha,
		hubUrl: params.hubUrl,
		fetch: params.fetch,
	});

	for await (const entry of cursor) {
		await downloadFile({
			repo: params.repo,
			path: entry.path,
			revision: params.revision,
			hubUrl: params.hubUrl,
			fetch: params.fetch,
			cacheDir: cacheDir,
		});
	}
}