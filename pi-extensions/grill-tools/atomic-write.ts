// Escritura atómica de los artefactos de grill-tools: escribe un `.tmp` al lado
// y lo renombra. Si la escritura o el rename fallan, borra el `.tmp` (spec #84,
// CA-10) para no dejar residuos en `.sdd/` ni en `<git-common-dir>/sdd/`.

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export interface AtomicWriteFs {
	writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

const defaultFs: AtomicWriteFs = {
	writeFile: (path, content, encoding) => writeFile(path, content, encoding),
	rename,
};

export async function writeFileAtomic(path: string, content: string, fs: AtomicWriteFs = defaultFs): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, content, "utf8");
		await fs.rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
