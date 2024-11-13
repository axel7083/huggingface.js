import { expect, test, describe, vi, beforeEach } from "vitest";
import { downloadFile, downloadFileToCacheDir } from "./download-file";
import type { RepoId } from "../types/public";
import { fileDownloadInfo } from "./file-download-info";
import { join } from "node:path";
import { lstat, mkdir, stat } from "node:fs/promises";

vi.mock('node:fs/promises', () => ({
	writeFile: vi.fn(),
	rename: vi.fn(),
	symlink: vi.fn(),
	lstat: vi.fn(),
	mkdir: vi.fn(),
	stat: vi.fn()
}));

vi.mock('./file-download-info', () => ({
	fileDownloadInfo: vi.fn(),
}));

const DUMMY_REPO: RepoId = {
	name: 'hello-world',
	type: 'model',
};

const DUMMY_ETAG = "\"dummy-etag\"";
const DUMMY_BLOB_POINTER = join('models--hello-world', 'blobs', 'dummy-etag');

describe('downloadFileToCacheDir', () => {
	const fetchMock: typeof fetch = vi.fn();
	beforeEach(() => {
		vi.resetAllMocks();
		// mock 200 request
		vi.mocked(fetchMock).mockResolvedValue({
			status: 200,
			ok: true,
			body: 'dummy-body'
		} as unknown as Response);

		// prevent to use caching
		vi.mocked(stat).mockRejectedValue(new Error('Do not exists'));
		vi.mocked(lstat).mockRejectedValue(new Error('Do not exists'));
	});

	test('should throw an error if fileDownloadInfo return nothing', async () => {
		await expect(async () => {
			await downloadFileToCacheDir({
				repo: DUMMY_REPO,
				path: '/README.md',
				fetch: fetchMock,
			});
		}).rejects.toThrowError('cannot get download info for /README.md');

		expect(fileDownloadInfo).toHaveBeenCalledWith({
			repo: DUMMY_REPO,
			path: '/README.md',
			fetch: fetchMock,
		});
	});

	test('expect resolve value to be the pointer path of downloaded file', async () => {
		vi.mocked(fileDownloadInfo).mockResolvedValue({
			etag: DUMMY_ETAG,
			size: 55,
			downloadLink: null,
			commitHash: 'dummy-commit-hash',
		});

		const output = await downloadFileToCacheDir({
			repo: DUMMY_REPO,
			path: '/README.md',
			fetch: fetchMock,
		});

		// expect blobs and snapshots folder to have been mkdir
		expect((vi.mocked(mkdir).mock.calls[0][0] as string).endsWith('blobs') ).toBeTruthy();
		expect((vi.mocked(mkdir).mock.calls[1][0] as string).endsWith(join('snapshots', 'dummy-commit-hash')) ).toBeTruthy();

		expect(output.endsWith(DUMMY_BLOB_POINTER)).toBeTruthy();
	});
});

describe("downloadFile", () => {
	test("hubUrl params should overwrite HUB_URL", async () => {
		const fetchMock: typeof fetch = vi.fn();
		vi.mocked(fetchMock).mockResolvedValue({
			status: 200,
			ok: true,
		} as Response);

		await downloadFile({
			repo: DUMMY_REPO,
			path: '/README.md',
			hubUrl: 'http://dummy-hub',
			fetch: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledWith('http://dummy-hub/hello-world/resolve/main//README.md', expect.anything());
	});

	test("raw params should use raw url", async () => {
		const fetchMock: typeof fetch = vi.fn();
		vi.mocked(fetchMock).mockResolvedValue({
			status: 200,
			ok: true,
		} as Response);

		await downloadFile({
			repo: DUMMY_REPO,
			path: 'README.md',
			raw: true,
			fetch: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledWith('https://huggingface.co/hello-world/raw/main/README.md', expect.anything());
	});

	test("internal server error should propagate the error", async () => {
		const fetchMock: typeof fetch = vi.fn();
		vi.mocked(fetchMock).mockResolvedValue({
			status: 500,
			ok: false,
			headers: new Map<string, string>([["Content-Type", "application/json"]]),
			json: () => ({
				error: 'Dummy internal error',
			}),
		} as unknown as Response);

		await expect(async () => {
			await downloadFile({
				repo: DUMMY_REPO,
				path: 'README.md',
				raw: true,
				fetch: fetchMock,
			});
		}).rejects.toThrowError('Dummy internal error');
	});
});