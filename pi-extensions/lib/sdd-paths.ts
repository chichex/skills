/**
 * @deprecated Usá `./chiche-paths.ts` (issue #103, CA-1). Este módulo solo
 * reexporta los nombres anteriores hasta que una spec posterior retire la
 * doble lectura de `.sdd/`.
 */
export {
	artifactReadDirs as sddArtifactReadDirs,
	defaultGitRunner,
	isArtifactPath as isSddArtifactPath,
	listArtifacts as listSddArtifacts,
	localArtifactDir as localSddArtifactDir,
	resolveArtifactDirs as resolveSddArtifactDirs,
	resolveArtifactName as resolveSddArtifactName,
	resolveGitCommonDir,
	resolveRepoWorktrees,
	trackedArtifactDirs as trackedSddArtifactDirs,
} from "./chiche-paths.ts";
export type {
	ArtifactDirs as SddArtifactDirs,
	ArtifactEntry as SddArtifactEntry,
	ArtifactKind as SddArtifactKind,
	GitRunner,
} from "./chiche-paths.ts";
