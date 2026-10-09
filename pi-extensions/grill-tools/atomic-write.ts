// Escritura atómica de los artefactos de grill-tools: escribe un `.tmp` al lado
// y lo renombra. Si la escritura o el rename fallan, borra el `.tmp` (spec #84,
// CA-10) para no dejar residuos en `.sdd/` ni en `<git-common-dir>/sdd/`.

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export interface AtomicWriteFs {
	writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	rm?(path: string, options: { force: true }): Promise<void>;
}

const defaultFs: AtomicWriteFs = {
	writeFile: (path, content, encoding) => writeFile(path, content, encoding),
	rename,
	rm,
};

export async function writeFileAtomic(path: string, content: string, fs: AtomicWriteFs = defaultFs): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, content, "utf8");
		await fs.rename(temporary, path);
	} catch (error) {
		// Un rm que falla por el mismo motivo no tapa el error que explica la falla.
		await (fs.rm ?? rm)(temporary, { force: true }).catch(() => {});
		throw error;
	}
}
