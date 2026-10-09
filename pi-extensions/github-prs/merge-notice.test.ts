// CA-21 (spec #84): después de un merge exitoso, /prs sugiere
// `/skill:sdd-land --clean-only` y nombra los branches que quedan, sin borrar
// nada. La conducta TUI completa (selector y loaders) es prueba humana; acá se
// prueba el mensaje y que el flujo de merge no tiene ninguna ruta de borrado.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { mergeCleanupNotice } from "./merge-notice.ts";

test("CA-21: tras el merge sugiere /skill:sdd-land --clean-only y nombra el branch remoto y el local que quedan", () => {
	const notice = mergeCleanupNotice({ number: 42, headRefName: "sdd/cero-residuos/1-sdd-land", localBranchExists: true, isCrossRepository: false });
	assert.match(notice, /`\/skill:sdd-land --clean-only`/);
	assert.match(notice, /remoto `sdd\/cero-residuos\/1-sdd-land`/);
	assert.match(notice, /local `sdd\/cero-residuos\/1-sdd-land`/);
	assert.match(notice, /no borra nada/);
});

test("CA-21: sin branch local nombra solo el remoto", () => {
	const notice = mergeCleanupNotice({ number: 7, headRefName: "fix/x", localBranchExists: false, isCrossRepository: false });
	assert.match(notice, /remoto `fix\/x`/);
	assert.doesNotMatch(notice, /local `fix\/x`/);
	assert.match(notice, /`\/skill:sdd-land --clean-only`/);
});

test("CA-21: el merge de /prs muestra la sugerencia y no ejecuta git branch -d ni --delete-branch", async () => {
	const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/merge-notice\.ts"/);
	assert.match(source, /mergeCleanupNotice\(\{/);
	assert.doesNotMatch(source, /--delete-branch/);
	assert.doesNotMatch(source, /"branch",\s*"-[dD]"/);
	assert.doesNotMatch(source, /"push",[^\]]*"--delete"/);
	assert.doesNotMatch(source, /git\/refs\/heads/);
	// Review de #87: show-ref exacto (un tag homónimo no confunde) e isCrossRepository pedido al listar.
	assert.match(source, /"show-ref", "--verify", "--quiet", `refs\/heads\/\$\{pr\.headRefName\}`/);
	assert.doesNotMatch(source, /%\(refname:short\)/);
	assert.match(source, /headRefName,baseRefName,[^"]*isCrossRepository/);
});

test("CA-21 (review #87): un PR de fork no nombra branches de este repo", () => {
	const notice = mergeCleanupNotice({ number: 9, headRefName: "main", localBranchExists: true, isCrossRepository: true });
	assert.doesNotMatch(notice, /`main`/);
	assert.match(notice, /viene de un fork/);
});
