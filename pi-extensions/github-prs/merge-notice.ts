// Mensaje posterior a un merge exitoso de /prs (spec #84, CA-21): nombra los
// branches que quedan vivos y sugiere `/skill:sdd-land --clean-only`, que los
// borra con prueba de merge. /prs no borra nada: mergea sin `--delete-branch`.

export interface MergeCleanupInput {
	number: number;
	headRefName: string;
	localBranchExists: boolean;
	/** PR de un fork: su `headRefName` es un branch del fork, no de este repo. */
	isCrossRepository: boolean;
}

export function mergeCleanupNotice(input: MergeCleanupInput): string {
	if (input.isCrossRepository) return `El PR #${input.number} viene de un fork: no deja branches de este repo para limpiar.`;
	const branches = [`el branch remoto \`${input.headRefName}\` (salvo que el repo lo borre al mergear)`];
	if (input.localBranchExists) branches.push(`el local \`${input.headRefName}\``);
	return `Quedan ${branches.join(" y ")} del PR #${input.number}. Para limpiarlos con prueba de merge corré \`/skill:sdd-land --clean-only\`; /prs no borra nada.`;
}
