import path from 'node:path';
import type { Manifest } from './manifest.js';

/** Where Forge keeps generated files inside a workspace. Everything under `.forge` can be deleted. */
export const workspacePaths = (workspace: string, manifest: Manifest) => ({
  buildDirectory: path.join(workspace, '.forge', 'build'),
  binary: path.resolve(workspace, manifest.binary),
  candidateBuildDirectory: path.join(workspace, '.forge', 'candidate', 'build'),
  candidateBinary: path.join(workspace, '.forge', 'candidate', 'router'),
});

export const modulesDirectory = 'modules';
