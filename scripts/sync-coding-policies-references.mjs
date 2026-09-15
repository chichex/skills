#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CODING_POLICIES_HARNESSES = ["claude", "codex", "opencode", "pi"];

const SKILL = "coding-policies";
const CANONICAL_DIRECTORY = join("shared", SKILL, "references");
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE_NAME = /^[a-z][a-z0-9-]*\.md$/;

async function referenceNames(directory, { allowMissing = false } = {}) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (allowMissing && error && typeof error === "object" && error.code === "ENOENT") return [];
		throw error;
	}
	const markdownEntries = entries.filter((entry) => entry.name.endsWith(".md"));
	const invalid = markdownEntries.filter((entry) => !entry.isFile() || !REFERENCE_NAME.test(entry.name));
	if (invalid.length > 0) {
		throw new Error(
			`${relative(DEFAULT_REPO_ROOT, directory)} contiene referencias inválidas: ${invalid.map((entry) => entry.name).join(", ")}`,
		);
	}
	return markdownEntries.map((entry) => entry.name).sort();
}

function mirrorDirectory(repoRoot, harness) {
	return join(repoRoot, harness, SKILL, "references");
}

export async function inspectReferenceMirrors(repoRoot = DEFAULT_REPO_ROOT) {
	const canonicalDirectory = join(repoRoot, CANONICAL_DIRECTORY);
	const canonicalNames = await referenceNames(canonicalDirectory);
	if (canonicalNames.length === 0) throw new Error(`${CANONICAL_DIRECTORY} no contiene referencias`);

	const problems = [];
	for (const harness of CODING_POLICIES_HARNESSES) {
		const destination = mirrorDirectory(repoRoot, harness);
		const mirrorNames = await referenceNames(destination, { allowMissing: true });
		for (const name of canonicalNames) {
			if (!mirrorNames.includes(name)) {
				problems.push(`${harness}: falta references/${name}`);
				continue;
			}
			const [canonical, mirror] = await Promise.all([
				readFile(join(canonicalDirectory, name)),
				readFile(join(destination, name)),
			]);
			if (!canonical.equals(mirror)) problems.push(`${harness}: references/${name} difiere de la fuente canónica`);
		}
		for (const name of mirrorNames) {
			if (!canonicalNames.includes(name)) problems.push(`${harness}: references/${name} no existe en la fuente canónica`);
		}
	}
	return { canonicalNames, problems };
}

export async function syncReferenceMirrors(repoRoot = DEFAULT_REPO_ROOT) {
	const canonicalDirectory = join(repoRoot, CANONICAL_DIRECTORY);
	const canonicalNames = await referenceNames(canonicalDirectory);
	if (canonicalNames.length === 0) throw new Error(`${CANONICAL_DIRECTORY} no contiene referencias`);

	for (const harness of CODING_POLICIES_HARNESSES) {
		const destination = mirrorDirectory(repoRoot, harness);
		await mkdir(destination, { recursive: true });
		const mirrorNames = await referenceNames(destination);
		for (const name of mirrorNames) {
			if (!canonicalNames.includes(name)) await rm(join(destination, name), { force: true });
		}
		for (const name of canonicalNames) {
			await copyFile(join(canonicalDirectory, name), join(destination, name));
		}
	}

	const inspection = await inspectReferenceMirrors(repoRoot);
	if (inspection.problems.length > 0) throw new Error(inspection.problems.join("\n"));
	return { references: canonicalNames.length, harnesses: CODING_POLICIES_HARNESSES.length };
}

async function main(args) {
	if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
		console.error("Uso: node scripts/sync-coding-policies-references.mjs [--check]");
		process.exitCode = 2;
		return;
	}
	if (args[0] === "--check") {
		const inspection = await inspectReferenceMirrors();
		if (inspection.problems.length > 0) {
			for (const problem of inspection.problems) console.error(`✗ ${problem}`);
			process.exitCode = 1;
			return;
		}
		console.log(
			`OK: ${inspection.canonicalNames.length} referencias canónicas sincronizadas en ${CODING_POLICIES_HARNESSES.length} harnesses.`,
		);
		return;
	}
	const result = await syncReferenceMirrors();
	console.log(`Sincronizadas ${result.references} referencias canónicas en ${result.harnesses} harnesses.`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPoint === import.meta.url) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
