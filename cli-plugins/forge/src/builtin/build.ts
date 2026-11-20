import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { buildModuleName, renderGoMod, renderMainGo } from './build-module.js';
import type { BuildModule } from './build-module.js';
import { lastLines } from './failure.js';
import type { Lock } from './lock.js';
import { isLocalModule, manifestFileName } from './manifest.js';
import type { Manifest } from './manifest.js';
import { routerModule } from './resolve.js';
import type { System } from './system.js';

export interface BuildRequest {
  workspace: string;
  manifest: Manifest;
  lock: Lock;
  /** Where go.mod and main.go are generated. */
  buildDirectory: string;
  /** Where the finished binary goes. It is only replaced when the build succeeds. */
  binaryPath: string;
  routerReplace?: string;
  system: System;
  output: Output;
}

export const readLocalModuleName = async (workspace: string, modulePath: string): Promise<Result<string>> => {
  const goModPath = path.resolve(workspace, modulePath, 'go.mod');
  let goMod: string;
  try {
    goMod = await readFile(goModPath, 'utf8');
  } catch {
    return failWith({
      message: `Local module ${modulePath} has no go.mod.`,
      input: `${manifestFileName}: modules path ${modulePath}`,
      remediation: `Create the module with \`wgc forge create\`, or run \`go mod init\` in ${modulePath}.`,
    });
  }

  const name = /^module\s+(\S+)/m.exec(goMod)?.[1];
  if (name === undefined) {
    return failWith({
      message: `${goModPath} does not declare a module.`,
      input: goModPath,
      remediation: 'Add a `module <name>` line to the go.mod.',
    });
  }
  return { success: true, data: name };
};

const describeBuildModule = async ({
  workspace,
  manifest,
  lock,
  buildDirectory,
  routerReplace,
}: BuildRequest): Promise<Result<BuildModule>> => {
  const versions = new Map<string, string>();
  for (const module of lock.modules) {
    const other = versions.get(module.module);
    if (other !== undefined && other !== module.version) {
      return failWith({
        message: `Module ${module.module} is pinned at two versions, ${other} and ${module.version}. A router is built with one version of each module.`,
        input: `${manifestFileName}: modules ${module.module}`,
        remediation: `Use the same version or ref for every entry of ${module.module} in ${manifestFileName}, then run \`wgc forge lock\`.`,
      });
    }
    versions.set(module.module, module.version);
  }

  const localModules: BuildModule['localModules'] = [];
  for (const source of manifest.modules) {
    if (!isLocalModule(source)) {
      continue;
    }
    const name = await readLocalModuleName(workspace, source.path);
    if (!name.success) {
      return name;
    }
    const directory = path.relative(buildDirectory, path.resolve(workspace, source.path));
    localModules.push({ module: name.data, directory: directory.split(path.sep).join('/') });
  }

  return {
    success: true,
    data: {
      goVersion: lock.router.goVersion,
      routerVersion: lock.router.version,
      routerReplace: routerReplace === undefined ? undefined : path.resolve(workspace, routerReplace),
      remoteModules: lock.modules,
      localModules,
    },
  };
};

/** `go mod graph` lines are `<module>@<version> <required module>@<version>`. */
const findRequirer = (graph: string, required: string): string | undefined => {
  for (const line of graph.split('\n')) {
    const [from, to] = line.trim().split(' ');
    if (to === required && !from.startsWith(buildModuleName)) {
      return from.split('@')[0];
    }
  }
  return undefined;
};

/**
 * Go picks the highest version any module asks for. When that is not the pinned version, a module needs a
 * newer dependency than the workspace pins, and building anyway would ship something forge.lock does not say.
 */
const checkPinsHold = async (request: BuildRequest, build: BuildModule): Promise<Result<true>> => {
  const { system, buildDirectory } = request;
  const listed = await system.run({
    file: 'go',
    args: ['list', '-m', '-f', '{{.Path}} {{.Version}}', 'all'],
    cwd: buildDirectory,
  });
  if (listed.exitCode !== 0) {
    return failWith({
      message: `Go could not list the build's modules:\n${lastLines(listed.stderr)}`,
      input: buildDirectory,
    });
  }

  const selected = new Map<string, string>();
  for (const line of listed.stdout.split('\n')) {
    const [module, version] = line.trim().split(' ');
    if (module && version) {
      selected.set(module, version);
    }
  }

  const pins = [{ module: routerModule, version: build.routerVersion }, ...build.remoteModules];
  for (const pin of pins) {
    const selectedVersion = selected.get(pin.module);
    if (selectedVersion === undefined || selectedVersion === pin.version) {
      continue;
    }

    const graph = await system.run({ file: 'go', args: ['mod', 'graph'], cwd: buildDirectory });
    const requirer = findRequirer(graph.stdout, `${pin.module}@${selectedVersion}`) ?? 'another module';
    return failWith({
      message: `Module dependency conflict: ${requirer} requires ${pin.module} ${selectedVersion}, but the workspace pins ${pin.module} ${pin.version}.`,
      input: `${requirer} requires ${pin.module} ${selectedVersion}`,
      remediation:
        pin.module === routerModule
          ? `Upgrade the router to a version that includes ${selectedVersion} with \`wgc forge router upgrade\`, or use a version of ${requirer} built for the pinned router.`
          : `Pin ${pin.module} to ${selectedVersion} in ${manifestFileName}, or use a version of ${requirer} that works with ${pin.version}.`,
    });
  }
  return { success: true, data: true };
};

/**
 * Generates the build module and compiles the router with every module in it. The binary is compiled next to
 * its final path and moved over it only after the compiler succeeds, so a failed build leaves the old one.
 */
export const buildRouter = async (request: BuildRequest): Promise<Result<{ binary: string }>> => {
  const { buildDirectory, binaryPath, system, output } = request;

  const build = await describeBuildModule(request);
  if (!build.success) {
    return build;
  }

  output.progress({ step: 'write-build-module', subject: buildDirectory, message: 'Writing go.mod and main.go' });
  await mkdir(buildDirectory, { recursive: true });
  await writeFile(path.join(buildDirectory, 'go.mod'), renderGoMod(build.data));
  await writeFile(path.join(buildDirectory, 'main.go'), renderMainGo(build.data));

  output.progress({ step: 'tidy', message: 'Resolving Go dependencies (go mod tidy)' });
  const tidy = await system.run({ file: 'go', args: ['mod', 'tidy'], cwd: buildDirectory, env: { GOWORK: 'off' } });
  if (tidy.exitCode !== 0) {
    return failWith({
      message: `Go could not resolve the build's dependencies:\n${lastLines(tidy.stderr)}`,
      input: path.join(buildDirectory, 'go.mod'),
      remediation: 'Check that every module in forge.yaml builds against the pinned router version.',
    });
  }

  const pinsHold = await checkPinsHold(request, build.data);
  if (!pinsHold.success) {
    return pinsHold;
  }

  const temporaryBinary = `${binaryPath}.building-${process.pid}`;
  await mkdir(path.dirname(binaryPath), { recursive: true });

  output.progress({ step: 'compile', message: 'Compiling the router (go build)' });
  const compile = await system.run({
    file: 'go',
    args: ['build', '-o', temporaryBinary, '.'],
    cwd: buildDirectory,
    env: { GOWORK: 'off' },
  });
  if (compile.exitCode !== 0) {
    await rm(temporaryBinary, { force: true });
    return failWith({
      message: `The router did not compile:\n${lastLines(compile.stderr)}`,
      input: buildDirectory,
      remediation: 'Fix the compile errors in the modules above. The existing binary was left in place.',
    });
  }

  output.progress({ step: 'place-binary', subject: binaryPath, message: 'Moving the binary into place' });
  await rename(temporaryBinary, binaryPath);

  return { success: true, data: { binary: binaryPath } };
};
