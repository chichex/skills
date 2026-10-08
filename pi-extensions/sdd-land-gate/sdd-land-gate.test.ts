// Gate anti-drift del skill sdd-land (issue #66, CA-12 a CA-25).
//
// sdd-land existe en los cuatro harnesses con doctrina idéntica y solo la capa
// de interacción distinta. Este gate lee los SKILL.md reales, exige con regexes
// la doctrina de CA-13 a CA-23, compara la doctrina de los cuatro harnesses
// tras normalizar invocaciones y tool de preguntas, y observa el wiring del
// repo (retiro de repo-clean, README, manifest del plugin, contrato). No hay
// extensión Pi en este directorio: es solo-tests, igual que agents-gate. La
// conducta real contra GitHub (CA-26) es prueba humana y no se verifica acá.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	escapeRegExp,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

async function exists(path: string): Promise<boolean> {
	return access(repoFile(path)).then(
		() => true,
		() => false,
	);
}

function frontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match?.[1], "frontmatter presente");
	const fields: Record<string, string> = {};
	let current: string | null = null;
	for (const line of match[1].split("\n")) {
		const key = line.match(/^([a-z-]+):\s*(.*)$/);
		if (key) {
			current = key[1] ?? null;
			if (current) fields[current] = (key[2] ?? "").replace(/^[>|][+-]?$/, "").trim();
		} else if (current) {
			fields[current] = `${fields[current] ?? ""} ${line.trim()}`.trim();
		}
	}
	return fields;
}

function doctrineBlock(markdown: string): string {
	const block = markdown.match(/<!-- sdd-land-doctrine:start -->\n([\s\S]*?)\n<!-- sdd-land-doctrine:end -->/);
	assert.ok(block, "bloque delimitado sdd-land-doctrine presente");
	return block[1] ?? "";
}

function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## ") && heading.test(line));
	assert.notEqual(start, -1, `seccion ${heading} presente`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index]?.startsWith("## ")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

// Doctrina por CA, la misma en los cuatro harnesses.
const DOCTRINE: Record<string, RegExp[]> = {
	"CA-13": [
		/\/sdd-land \[<stack#> \| <PR#> \| <URL de PR> \.\.\.\] \[--method merge\|squash\|rebase\] \[--wait N\] \[--dry-run\] \[--clean-only\]/,
		/Pelado[\s\S]*lista los PRs abiertos del repo agrupados por stack[\s\S]*pregunta cuál/,
		/`--clean-only` \(sin targets\)[\s\S]*salta el merge[\s\S]*checkout principal[\s\S]*limpieza local[\s\S]*barrido[\s\S]*reporte/,
		/`Solo limpiar y sincronizar`[\s\S]*equivale a `--clean-only`/,
		/`<PR#>` dentro de un stack significa «hasta ese PR inclusive»[\s\S]*`gh stack merge <PR>`[\s\S]*el plan lista exactamente qué PRs aterrizan/,
		/Un PR sin stack es un stack de uno/,
		/`isCrossRepository`[\s\S]*se rechazan con diagnóstico/,
		/No existen `--yes` ni `--assume`/,
	],
	"CA-14": [
		/`gh auth status`/,
		/branch default leído del remote[\s\S]*nunca asumir `main`/,
		/`\.sdd\/project\.md` si existe[\s\S]*`## Limites` prohíbe mergear sin una excepción para `\/sdd-land`[\s\S]*frena antes de tocar nada/,
		/`gh stack` exigido solo si algún target es un stack/,
		/un PR pertenece a un stack si su `baseRefName` no es el default o si existe algún PR abierto cuyo `baseRefName` es su `headRefName`[\s\S]*se confirma con `gh stack view --json`/,
		/se recorre `baseRefName` hasta el branch default/,
		/cadena de PRs no vinculada[\s\S]*`gh stack link`/,
	],
	"CA-15": [
		/antes de cualquier mutación[\s\S]*orden \| PR \| branch \| base \| método \| checks \| threads sin resolver \| draft/,
		/worktrees, branches locales y remotos que va a borrar/,
		/`Mergear \(Recomendado\)` \/ `Cancelar`/,
		/`--dry-run` imprime el plan y termina/,
		/Sin confirmación no hay merge/,
	],
	"CA-16": [
		/abierto, no draft[\s\S]*`CONFLICTING`[\s\S]*`CHANGES_REQUESTED`[\s\S]*`statusCheckRollup`[\s\S]*lista de inclusión/,
		/cada `CheckRun` con `conclusion` `SUCCESS`, `NEUTRAL` o `SKIPPED` y cada `StatusContext` con `state` `SUCCESS`/,
		/check pendiente espera hasta `--wait`/,
		/cualquier otro estado \(`FAILURE`, `ERROR`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE`, `STALE`\) deja el target `DETENIDO`/,
		/`reviewThreads`[\s\S]*paginando hasta agotar/,
		/polling en primer plano cada 60 s hasta `--wait`[\s\S]*20 min[\s\S]*cancelable[\s\S]*sin `&` ni `nohup`/,
		/`DETENIDO`[\s\S]*sin merge parcial[\s\S]*targets independientes siguen/,
	],
	"CA-17": [
		/`gh stack merge <PR objetivo> --merge-method <m> --yes`[\s\S]*solo saltea el prompt propio de gh-stack[\s\S]*después de la confirmación/,
		/`<PR objetivo>` es el top del stack o el `<PR#>` pedido[\s\S]*ese PR y todos los de abajo, nunca los de arriba/,
		/aterrizaje parcial[\s\S]*no se borra ningún branch del stack, ni remoto ni local[\s\S]*pendiente/,
		/`gh pr merge <n> --<m>` sin `--delete-branch` ni `--admin`/,
		/`viewerDefaultMergeMethod`/,
		/merge queue[\s\S]*`en cola`[\s\S]*hasta `--wait`/,
		/releyendo `state == MERGED` de cada PR, nunca por exit code/,
	],
	"CA-18": [
		/solo cuando todos los PRs del target están `MERGED` y el aterrizaje no es parcial[\s\S]*`gh api -X DELETE`[\s\S]*`refs\/heads\/<branch>`[\s\S]*idempotente/,
		/solo branches remotos cuyo PR está `MERGED` \(`gh pr list --state merged --json headRefName`\) y que no tienen PR abierto[\s\S]*excluyendo el default y los branches protegidos[\s\S]*nunca por mera ancestría[\s\S]*UNA confirmación que nombra cada branch/,
		/Nunca borra un branch con PR abierto o sin mergear/,
	],
	"CA-19": [
		/`git fetch --prune`/,
		/`git worktree remove` solo si ese worktree está limpio[\s\S]*reporta la ruta/,
		/`git branch -d` \(nunca `-D`\)/,
		/`gh stack unstack --local`/,
		/`git worktree prune`/,
		/checkout principal está parado en uno de esos branches no cambia de branch[\s\S]*lo reporta con el comando/,
		/checkout principal no pudo sincronizarse[\s\S]*`git branch -d` puede negarse[\s\S]*se reporta con el comando, sin `-D`/,
	],
	"CA-20": [
		/branches locales ya mergeados en `origin\/<default>`[\s\S]*excluyendo el default y el actual/,
		/worktrees cuyo branch está mergeado o ya no existe/,
		/`Borrar todo lo listado` \/ `Elegir cuáles` \(selección múltiple\) \/ `No borrar`/,
		/Worktrees sucios y branches sin mergear solo se reportan con ruta y comando exacto/,
	],
	"CA-21": [
		/`git merge --ff-only origin\/<default>`/,
		/`git status --short --branch --untracked-files=all`[\s\S]*`git diff --stat`[\s\S]*`git clean -nd`/,
		/`Conservar en wip\/<fecha>-<slug>, sin push \(Recomendado\)` \/ `Descartar` \/ `Tratar por path` \/ `Dejar como está`/,
		/`git switch -c wip\/<YYYY-MM-DD>-<slug>`[\s\S]*sin secrets, sin `--no-verify`[\s\S]*fast-forward/,
		/`git reset --hard HEAD`[\s\S]*`git clean -fd`[\s\S]*nunca `-x`/,
		/una pregunta por path[\s\S]*`conservar \/ descartar \/ ignorar`[\s\S]*`ignorar` solo se ofrece para paths untracked[\s\S]*`\.git\/info\/exclude`[\s\S]*local, sin commit[\s\S]*solo se crea el branch `wip\/` si algún path eligió `conservar`/,
		/^(?![\s\S]*\.gitignore)[\s\S]*$/,
		/fast-forward a `origin\/<default>`[\s\S]*`Conservar`, `Descartar` y `Tratar por path`[\s\S]*`Dejar como está` es el único que no lo hace/,
		/commits locales adelante[\s\S]*se reporta, sin switch/,
		/Nunca stash/,
	],
	"CA-22": [
		/`SDD-LAND TERMINADO` solo con todos los targets mergeados y verificados/,
		/`HEAD == origin\/<default>` y status limpio/,
		/targets: ninguno \(--clean-only\)/,
		/pendiente: <capas abiertas encima del PR elegido/,
		/`SDD-LAND DETENIDO`[\s\S]*comando para reanudar/,
		/sha de merge[\s\S]*remotos borrados[\s\S]*worktrees removidos[\s\S]*branches borrados[\s\S]*ruido podado/,
	],
	"CA-23": [
		/no bypass de protección ni `--admin`/i,
		/no `git push --force\*`/i,
		/no push al default/i,
		/no reset, stash ni clean del checkout principal fuera del flujo de la Fase 5/i,
		/no borrar branches con PR abierto o sin mergear/i,
		/no cambiar settings del repo \(`deleteBranchOnMerge`, protecciones\)/i,
		/no polling en background/i,
		/no mergear sin la confirmación de la Fase 2/i,
	],
};

const SKILL_TRIGGERS = [
	"cerrar el stack",
	"mergear el stack",
	"landear",
	"dejar el repo limpio y al día",
	"repo clean",
];

test("CA-12: sdd-land existe en los cuatro harnesses con name, description y triggers; sidecar de Codex sin invocación implícita", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/sdd-land/SKILL.md`;
		if (!(await exists(path))) {
			problems.push(`${path} no existe`);
			continue;
		}
		const fields = frontmatter(await readRepoFile(path));
		if (fields.name !== "sdd-land") problems.push(`${path}: name=${fields.name}`);
		for (const trigger of SKILL_TRIGGERS) {
			if (!(fields.description ?? "").includes(trigger)) problems.push(`${path}: description sin el trigger «${trigger}»`);
		}
		if (harness === "pi" && !/\bgh\b/.test(fields.compatibility ?? "")) {
			problems.push(`${path}: compatibility no declara gh`);
		}
		if (harness !== "pi" && "compatibility" in fields) problems.push(`${path}: compatibility solo corresponde a Pi`);
	}
	assert.deepEqual(problems, []);

	const sidecar = await readRepoFile("codex/sdd-land/agents/openai.yaml");
	assert.match(sidecar, /interface:\n {2}display_name: "[^"]+"\n {2}short_description: "[^"]+"\n {2}default_prompt: "[^"]*\$sdd-land[^"]*"/);
	assert.match(sidecar, /policy:\n {2}allow_implicit_invocation: false/);
	for (const harness of ["claude", "opencode", "pi"]) {
		assert.equal(await exists(`${harness}/sdd-land/agents`), false, `${harness}/sdd-land no lleva agents/`);
	}
});

for (const [ca, patterns] of Object.entries(DOCTRINE)) {
	test(`${ca}: la doctrina de sdd-land está declarada en los cuatro harnesses`, async () => {
		const problems: string[] = [];
		const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
		for (const harness of HARNESSES) {
			// Las regexes se escriben con la sintaxis de Claude (`/sdd-land`): se normaliza y se vuelve a ella.
			const doctrine = normalizeInvocations(doctrineBlock(await readRepoFile(`${harness}/sdd-land/SKILL.md`)), prefixes[harness]).replace(/«skill:([a-z-]+)»/g, "/$1");
			for (const problem of missing(doctrine, patterns)) problems.push(`${harness}/sdd-land/SKILL.md: ${problem}`);
		}
		assert.deepEqual(problems, []);
	});
}

test("CA-13 a CA-23: la doctrina de sdd-land es idéntica entre harnesses tras normalizar invocaciones y tool de preguntas", async () => {
	const table = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const normalized = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const tool = table.questionTools[harness];
		let doctrine = doctrineBlock(await readRepoFile(`${harness}/sdd-land/SKILL.md`));
		doctrine = normalizeInvocations(doctrine, table.prefixes[harness]);
		if (tool !== null) doctrine = doctrine.replaceAll(`\`${tool}\``, "«tool-preguntas»");
		normalized.set(harness, doctrine);
	}
	const [reference, ...rest] = HARNESSES;
	const divergences = rest
		.filter((harness) => normalized.get(harness) !== normalized.get(reference))
		.map((harness) => `${reference} vs ${harness}: ${firstDifference(normalized.get(reference) ?? "", normalized.get(harness) ?? "")}`);
	assert.deepEqual(divergences, []);
	assert.match(normalized.get("claude") ?? "", /«tool-preguntas»/, "la doctrina nombra la tool de preguntas del harness");
});

test("CA-13 a CA-23: cada harness nombra su propia tool de preguntas y ninguna ajena", async () => {
	const { questionTools } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-land/SKILL.md`);
		for (const other of HARNESSES) {
			const tool = questionTools[other];
			if (tool === null) continue;
			const used = markdown.includes(`\`${tool}\``);
			if (other === harness && !used) problems.push(`${harness}/sdd-land/SKILL.md no nombra \`${tool}\``);
			if (other !== harness && used) problems.push(`${harness}/sdd-land/SKILL.md nombra la tool ajena \`${tool}\``);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-19, CA-21: las fases corren en el orden remotos, checkout principal, limpieza local, barrido y reporte", async () => {
	const expected = ["Remotos", "Checkout principal", "Limpieza local automática", "Barrido del ruido previo", "Reporte"];
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-land/SKILL.md`);
		const phases = [...markdown.matchAll(/^## Fase (\d+) — (.+)$/gm)].map((match) => `${match[1]}:${match[2]}`);
		const tail = phases.slice(-5);
		assert.deepEqual(tail, expected.map((name, index) => `${index + 4}:${name}`), `${harness}/sdd-land/SKILL.md: orden de fases`);
	}
});

test("CA-24: sdd-land dice que reemplaza a repo-clean, que existía en Codex y Pi, igual en los cuatro harnesses", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-land/SKILL.md`);
		assert.match(markdown, /Reemplaza a `repo-clean`, que existía en Codex y Pi: absorbe su sincronización del checkout principal\./, `${harness}/sdd-land/SKILL.md`);
	}
});

test("CA-21: Tratar por path pregunta por path y multiSelect/multiple queda solo para Elegir cuáles", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-land/SKILL.md`);
		const tail = markdown.split("<!-- sdd-land-doctrine:end -->")[1] ?? "";
		assert.match(tail, /`Tratar por path`[\s\S]*pregunta por path/, `${harness}/sdd-land/SKILL.md: capa de interacción de Tratar por path`);
		assert.doesNotMatch(tail, /la selección por path/, `${harness}/sdd-land/SKILL.md: la selección por path no es selección múltiple`);
	}
});

test("CA-23: MUST NOT DO y MUST DO de sdd-land existen en los cuatro harnesses", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-land/SKILL.md`);
		assert.match(section(markdown, /^## MUST DO$/), /confirma/i, `${harness}: MUST DO`);
		assert.match(section(markdown, /^## MUST NOT DO$/), /--admin/, `${harness}: MUST NOT DO`);
	}
});

test("CA-24: repo-clean se retira del árbol y del inventario; sdd-land lo reemplaza", async () => {
	const tracked = spawnSync("git", ["ls-files", "pi/repo-clean", "codex/repo-clean"], { cwd: REPO_ROOT, encoding: "utf8" });
	assert.equal(tracked.status, 0, tracked.stderr);
	assert.equal(tracked.stdout.trim(), "", "pi/repo-clean y codex/repo-clean siguen trackeados");
	assert.equal(await exists("pi/repo-clean"), false);
	assert.equal(await exists("codex/repo-clean"), false);

	const interaction = await readRepoFile("pi-extensions/harness-gate/interaction.ts");
	assert.doesNotMatch(interaction, /"repo-clean"/);
	assert.match(interaction, /"sdd-land"/);
	const pkg = await readRepoFile("pi-extensions/pi-package/pi-package.test.ts");
	assert.doesNotMatch(pkg, /pi\/repo-clean/);
	assert.match(pkg, /\.\/pi\/sdd-land\/SKILL\.md/);
});

test("CA-24: README.md y README.en.md sin repo-clean, con sdd-land en la tabla SDD y stacks en sdd-spec, sdd-run y sdd-review-loop", async () => {
	const headings: Record<string, RegExp> = {
		"README.md": /^## El workflow SDD$/m,
		"README.en.md": /^## The SDD workflow$/m,
	};
	for (const [path, heading] of Object.entries(headings)) {
		const markdown = await readRepoFile(path);
		assert.doesNotMatch(markdown, /repo-clean/, `${path} todavía menciona repo-clean`);
		const start = markdown.search(heading);
		assert.notEqual(start, -1, `${path}: sección del workflow SDD`);
		const next = markdown.indexOf("\n## ", start + 1);
		const sdd = markdown.slice(start, next === -1 ? undefined : next);
		const row = (name: string) => sdd.match(new RegExp(`^\\| \\*\\*\`${escapeRegExp(name)}\`\\*\\*[^|]*\\|.*$`, "m"))?.[0] ?? "";
		const land = row("sdd-land");
		assert.ok(land, `${path}: fila de sdd-land en la tabla del workflow SDD`);
		assert.match(land, /stack/i, `${path}: sdd-land menciona stacks`);
		assert.match(land, /(cierre|closing|close)/i, `${path}: sdd-land es la etapa de cierre`);
		for (const name of ["sdd-spec", "sdd-run", "sdd-review-loop"]) {
			assert.match(row(name), /stack/i, `${path}: la fila de ${name} menciona stacks`);
		}
	}
});

test("CA-24: plugin.json y marketplace.json nombran sdd-land con descripciones idénticas; los sidecars de Codex siguen siendo 15 o más", async () => {
	const plugin = JSON.parse(await readRepoFile(".claude-plugin/plugin.json")) as { description: string };
	const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
		plugins: Array<{ name: string; description: string }>;
	};
	const entry = marketplace.plugins.find((candidate) => candidate.name === "chichex-skills");
	assert.match(plugin.description, /sdd-land/);
	assert.equal(entry?.description, plugin.description, "descripciones byte a byte iguales");
	const tracked = spawnSync("git", ["ls-files", "codex"], { cwd: REPO_ROOT, encoding: "utf8" });
	const sidecars = tracked.stdout.split("\n").filter((path) => /^codex\/[^/]+\/agents\/openai\.yaml$/.test(path));
	assert.ok(sidecars.length >= 15, `sidecars de Codex: ${sidecars.length}`);
});

test("CA-24: el contrato autoriza el merge de /sdd-land, declara el gate nuevo y pinea la versión de gh-stack", async () => {
	const contract = await readRepoFile(".sdd/project.md");
	const limites = section(contract, /^## Limites$/);
	assert.match(limites, /No hacer `git push` a `main`, force-push ni mergear PRs, salvo `\/sdd-land` invocado por el humano, que confirma el plan antes de mergear\./);
	assert.match(section(contract, /^## Comandos$/), /node --test pi-extensions\/sdd-land-gate\/sdd-land-gate\.test\.ts/);
	assert.match(section(contract, /^## Gaps$/), /gh-stack[^\n]*v\d+\.\d+\.\d+/);
});

test("autotest: un harness sin la doctrina de un CA se reporta con el patrón que falta", () => {
	const problems = missing("texto sin nada relevante", DOCTRINE["CA-22"] ?? []);
	assert.ok(problems.length >= 4);
	assert.match(problems[0] ?? "", /SDD-LAND TERMINADO/);
});
