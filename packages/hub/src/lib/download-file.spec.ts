import { test } from "vitest";
import { downloadToFile } from "./download-file";

test('should download a file', async () => {
	return downloadToFile({
		url: 'https://huggingface.co/meetkai/functionary-small-v2.5-GGUF/resolve/main/functionary-small-v2.5.Q4_0.gguf?download=true',
		destinationPath: '/home/axel7083/Documents/models/functionary.incomplete'
	})
}, { timeout: 60_000 })