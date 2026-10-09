// CA-10 (spec #84): writeFileAtomic no deja su `.tmp` cuando falla la
// escritura o el rename. Las fallas se inyectan por el seam de fs.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeFileAtomic } from "./atomic-write.ts";

function scratch(t: { after(fn: () => void): void }): string {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "atomic-write-")));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test("CA-10: writeFileAtomic borra su .tmp si falla el rename", async (t) => {
	const directory = scratch(t);
	const target = join(directory, "handoff.md");
	await assert.rejects(
		writeFileAtomic(target, "contenido\n", {
			writeFile: (path, content, encoding) => writeFile(path, content, encoding),
			rename: async () => {
				throw new Error("rename falló");
			},
		}),
		/rename falló/,
	);
	assert.deepEqual(readdirSync(directory), [], "no queda ni el .tmp ni el destino");
});

test("CA-10: writeFileAtomic borra su .tmp si falla writeFile a mitad de camino", async (t) => {
	const directory = scratch(t);
	const target = join(directory, "spec.md");
	await assert.rejects(
		writeFileAtomic(target, "contenido completo\n", {
			writeFile: async (path, content, encoding) => {
				await writeFile(path, content.slice(0, 4), encoding);
				throw new Error("disco lleno");
			},
			rename: async () => assert.fail("no debe renombrar tras una escritura fallida"),
		}),
		/disco lleno/,
	);
	assert.deepEqual(readdirSync(directory), [], "no queda el .tmp parcial");
});

test("CA-10: writeFileAtomic escribe el destino sin dejar temporales", async (t) => {
	const directory = scratch(t);
	const target = join(directory, "ok.md");
	await writeFileAtomic(target, "listo\n");
	assert.equal(readFileSync(target, "utf8"), "listo\n");
	assert.deepEqual(readdirSync(directory), ["ok.md"]);
});

test("CA-10 (review #86): si también falla el borrado del .tmp, se propaga el error original", async (t) => {
	const directory = scratch(t);
	const target = join(directory, "handoff.md");
	await assert.rejects(
		writeFileAtomic(target, "contenido\n", {
			writeFile: (path, content, encoding) => writeFile(path, content, encoding),
			rename: async () => {
				throw new Error("rename falló");
			},
			rm: async () => {
				throw new Error("rm falló");
			},
		}),
		/rename falló/,
	);
});
