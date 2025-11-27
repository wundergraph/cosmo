import { chmod, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'pathe';
import pc from 'picocolors';
import { execa } from 'execa';
import {
  compileGraphQLToMapping,
  compileGraphQLToProto,
  ProtoLock,
  ProtoOption,
  validateGraphQLSDL,
} from '@wundergraph/protographic';
import prompts from 'prompts';
import semver from 'semver';
import { camelCase, upperFirst } from 'lodash-es';
import pupa from 'pupa';
import { dataDir } from '../../../../core/config.js';
import TsTemplates from './templates/typescript.js';
import { renderValidationResults } from './helper.js';

// Define platform-architecture combinations
export function getHostPlatform(language: string) {
  const basePlatform = `${os.platform()}-${getOSArch(language)}`;
  if (language === 'ts') {
    return `bun-${basePlatform}`;
  }
  return basePlatform;
}

const ALL_GO_PLATFORMS = ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64', 'windows-amd64'];

// Both bun-linux-x64 share the same bun-linux-x64-musl target name of linux-amd64, thus we prefer musl, since it seems to be
// more compatible, users can still override this by explicitly specifying what they want
const ALL_BUN_PLATFORMS = [
  'bun-linux-x64-musl',
  'bun-linux-arm64-musl',
  'bun-windows-x64',
  'bun-darwin-arm64',
  'bun-darwin-x64',
];

const ALL_BUN_PLATFORM_MAPPINGS: Record<string, string> = {
  'bun-linux-x64': 'linux-amd64',
  'bun-linux-arm64': 'linux-arm64',
  'bun-darwin-x64': 'darwin-amd64',
  'bun-darwin-arm64': 'darwin-arm64',
  'bun-windows-x64': 'windows-amd64',
  'bun-linux-x64-musl': 'linux-amd64',
  'bun-linux-arm64-musl': 'linux-arm64',
};

const installScriptUrl =
  'https://raw.githubusercontent.com/wundergraph/cosmo/refs/tags/wgc%400.96.0/scripts/install-proto-tools.sh';

const defaultGoModulePath = 'github.com/wundergraph/cosmo/plugin';

// Get paths for tool installation
const TOOLS_DIR = join(dataDir, 'proto-tools');
const TOOLS_BIN_DIR = join(TOOLS_DIR, 'bin');
const TOOLS_VERSIONS_FILE = join(TOOLS_DIR, 'versions.json');

// Tool version structure
interface ToolVersion {
  range: string; // Semver range for version checking. Must be compatible with script version
  envVar: string; // Environment variable name used in install script
  scriptVersion: string; // Exact version to pass to install a script
  versionCommand: string; // Command to check version (e.g. "go", "protoc")
  versionFlag: string; // Flag to print the version (e.g. "--version")
}

type ToolVersionLanguageMapping = Record<string, ToolVersion>;

const COMMON_TOOL_VERSIONS: ToolVersionLanguageMapping = {
  protoc: {
    range: '^29.3',
    envVar: 'PROTOC_VERSION',
    scriptVersion: '29.3',
    versionCommand: 'protoc',
    versionFlag: '--version',
  },
};

// Exact tool versions to be installed for the script, but you can specify a semver range to express compatibility
const GO_TOOL_VERSIONS: ToolVersionLanguageMapping = {
  go: {
    range: '>=1.22.0',
    envVar: 'GO_VERSION',
    scriptVersion: '1.24.1',
    versionCommand: 'go',
    versionFlag: 'version',
  },
  protocGenGo: {
    range: '^1.34.2',
    envVar: 'PROTOC_GEN_GO_VERSION',
    scriptVersion: '1.34.2',
    versionCommand: 'protoc-gen-go',
    versionFlag: '--version',
  },
  protocGenGoGrpc: {
    range: '^1.5.1',
    envVar: 'PROTOC_GEN_GO_GRPC_VERSION',
    scriptVersion: '1.5.1',
    versionCommand: 'protoc-gen-go-grpc',
    versionFlag: '--version',
  },
};

const TS_TOOL_VERSIONS: ToolVersionLanguageMapping = {
  bun: {
    range: '^1.2.15',
    envVar: 'BUN_VERSION',
    scriptVersion: '1.2.15',
    versionCommand: 'bun',
    versionFlag: '--version',
  },
  // Node is needed for the protoc-gen-js plugins, for runtime we still only use bun
  node: {
    range: '^22.12.0',
    envVar: 'NODE_VERSION',
    scriptVersion: '22.12.0',
    versionCommand: 'node',
    versionFlag: '--version',
  },
};

// We combine all tool versions here, per language
const LanguageSpecificTools: Record<string, ToolVersionLanguageMapping> = {
  go: { ...COMMON_TOOL_VERSIONS, ...GO_TOOL_VERSIONS },
  ts: { ...COMMON_TOOL_VERSIONS, ...TS_TOOL_VERSIONS },
};

/**
 * Get the path to a tool, preferring the installed version if available
 */
function getToolPath(toolName: string): string {
  return existsSync(join(TOOLS_BIN_DIR, toolName)) ? join(TOOLS_BIN_DIR, toolName) : toolName;
}

function getOSArch(language: string): string {
  const arch = os.arch();
  if (language !== 'go') {
    return arch;
  }

  if (arch === 'x64') {
    return 'amd64';
  }
  return arch;
}

/**
 * Check if tools need to be reinstalled by comparing version matrices
 */
async function shouldReinstallTools(force = false, language: string): Promise<[boolean, boolean]> {
  // If forcing reinstallation, return true for both
  if (force) {
    return [true, true];
  }

  // If a version file exists, we assume the user manages the tools via toolchain
  if (existsSync(TOOLS_VERSIONS_FILE)) {
    try {
      // Read stored versions and compare with current versions
      const storedVersionsStr = await readFile(TOOLS_VERSIONS_FILE, 'utf8');
      const storedVersions = JSON.parse(storedVersionsStr) as Record<string, string>;

      const toolVersionsForLanguage = LanguageSpecificTools[language];

      // Separate common tools from language-specific tools
      const commonToolNames = Object.keys(COMMON_TOOL_VERSIONS);
      const languageSpecificToolNames = Object.keys(toolVersionsForLanguage).filter(
        (tool) => !commonToolNames.includes(tool),
      );

      let commonToolsChanged = false;
      let existingToolsNeedUpdate = false;
      let newToolsNeeded = false;

      // Check if common tools have changed versions
      for (const commonTool of commonToolNames) {
        const toolConfig = toolVersionsForLanguage[commonTool];
        if (!toolConfig) {
          continue;
        }

        const storedVersion = storedVersions[commonTool];
        if (!storedVersion) {
          commonToolsChanged = true;
          break;
        }

        if (!isSemverSatisfied(storedVersion, toolConfig.range)) {
          console.log(
            pc.yellow(
              `Common tool ${commonTool} version mismatch: found ${storedVersion}, required ${toolConfig.range}. Reinstalling...`,
            ),
          );
          commonToolsChanged = true;
          break;
        }
      }

      // Check language-specific tools
      for (const langTool of languageSpecificToolNames) {
        const toolConfig = toolVersionsForLanguage[langTool];
        const storedVersion = storedVersions[langTool];

        if (!storedVersion) {
          // Tool not installed - this is a new language being added
          console.log(pc.yellow(`Language-specific tool ${langTool} not found. Installing ${language} toolchain...`));
          newToolsNeeded = true;
        } else if (!isSemverSatisfied(storedVersion, toolConfig.range)) {
          // Tool exists but needs update
          console.log(
            pc.yellow(
              `Language-specific tool ${langTool} version mismatch: found ${storedVersion}, required ${toolConfig.range}. Reinstalling...`,
            ),
          );
          existingToolsNeedUpdate = true;
          break;
        }
      }

      // Determine if we need to reinstall and cleanup
      const shouldReinstall = commonToolsChanged || existingToolsNeedUpdate || newToolsNeeded;
      if (!shouldReinstall) {
        return [false, false];
      }

      // Only cleanup if common tools changed or existing tools need update, not for new tools
      const shouldCleanup = commonToolsChanged || existingToolsNeedUpdate;
      return [shouldReinstall, shouldCleanup];
    } catch {
      // If any error occurs during version checking, assume reinstallation is needed
      return [true, true];
    }
  }

  // if we haven't installed the tools yet, we check first if the tools are installed on the host system,
  // and if they are not, we need to install them through the toolchain installation
  try {
    const toolsOnHost = await areToolsInstalledOnHost(language);
    if (toolsOnHost) {
      return [false, false];
    }
    return [true, true]; // Fresh install, cleanup needed
  } catch {
    // If error checking host tools, installation is needed
    return [true, true];
  }
}

/**
 * Check if all required tools are installed on the host system with correct versions
 */
async function areToolsInstalledOnHost(language: string): Promise<boolean> {
  const languageSpecificTools = LanguageSpecificTools[language];

  if (!languageSpecificTools) {
    console.log(pc.yellow(`No toolchain configuration found for language '${language}'.`));
    return false;
  }

  try {
    for (const [toolName, toolConfig] of Object.entries(languageSpecificTools)) {
      const installedVersion = await getCommandVersion(toolConfig.versionCommand, toolConfig.versionFlag);

      if (!isSemverSatisfied(installedVersion, toolConfig.range)) {
        console.log(
          pc.yellow(
            `${pc.bold(toolName)} version mismatch on host: found ${installedVersion}, required ${toolConfig.range}`,
          ),
        );
        return false;
      }
    }

    return true;
  } catch (error: any) {
    console.log(pc.yellow(`Error checking tools for language '${language}': ${error.message}`));
    return false;
  }
}

/**
 * Compare versions using semver
 */
function isSemverSatisfied(version: string, requiredVersion: string): boolean {
  try {
    // Clean versions using semver.clean that handle v prefix
    const cleanVersion = semver.clean(version) || version;

    // For actual version, always coerce to a clean semver string
    const coercedVersion = semver.coerce(cleanVersion)?.version;
    if (!coercedVersion) {
      return false;
    }

    // For ranges, use as is (ranges are not supported for tool versions)
    if (semver.validRange(requiredVersion)) {
      return semver.satisfies(coercedVersion, requiredVersion);
    }

    // If not a range, coerce the required version too
    const coercedRequiredVersion = semver.coerce(requiredVersion)?.version;
    if (!coercedRequiredVersion) {
      return false;
    }

    return semver.satisfies(coercedVersion, coercedRequiredVersion);
  } catch {
    // If any error in semver processing, fall back to string comparison
    return version === requiredVersion;
  }
}

/**
 * Extract version from command output
 */
async function getCommandVersion(command: string, versionFlag: string): Promise<string> {
  // This pattern will match:
  // Optional "v" or "V" prefix
  // Versions with 2 or 3 components like "1.22", "29.3", or "1.22.0"
  // Captures the version number in group 1

  const versionRegex = /[Vv]?(\d+(?:\.\d+){1,2})/;

  try {
    const { stdout } = await execa(command, [versionFlag]);
    const match = stdout.match(versionRegex);
    if (!match || !match[1]) {
      throw new Error(`Could not parse version from output: ${stdout}`);
    }
    return match[1];
  } catch (error) {
    throw new Error(`Failed to get version for ${command}: ${error}`);
  }
}

export function validateAndGetGoModulePath(language: string, goModulePath: string | undefined): string | undefined {
  if (language === 'go') {
    if (goModulePath === undefined) {
      goModulePath = defaultGoModulePath;
    }
    return goModulePath;
  }

  if (goModulePath !== undefined) {
    throw new Error(`Go Module Path not supported for language '${language}'`);
  }
}

/**
 * Check if tools need installation and ask the user if needed
 */
export async function checkAndInstallTools(
  force = false,
  language: string,
  autoConfirmPrompts: boolean,
): Promise<boolean> {
  const [needsReinstall, shouldCleanup] = await shouldReinstallTools(force, language);

  if (!needsReinstall) {
    return true;
  }

  const toolVersionsForLanguage = LanguageSpecificTools[language];

  // Create a more informative message with simple formatting
  const toolsInfo = Object.entries(toolVersionsForLanguage)
    .filter(([tool]) => shouldCleanup || !Object.keys(COMMON_TOOL_VERSIONS).includes(tool))
    .map(([tool, { range: version }]) => `  ${pc.cyan('•')} ${pc.bold(tool)}: ${version}`)
    .join('\n');

  console.log(
    pc.yellow('\n=== Required Toolchain ===') +
      '\n\n' +
      pc.white('The following tools are needed to build the router plugin:') +
      '\n\n' +
      toolsInfo +
      '\n\n',
  );

  // In case of auto-confirm, skip the prompt
  if (autoConfirmPrompts) {
    console.log(pc.white('These tools will now be automatically installed') + '\n');
  } else {
    console.log(
      pc.white('You can install them automatically or manually install them yourself') +
        '\n' +
        pc.white('by following the documentation at https://cosmo-docs.wundergraph.com') +
        '\n',
    );

    // Ask user for confirmation to install tools
    const installMessage = existsSync(TOOLS_DIR)
      ? 'Version changes detected. Install required toolchain?'
      : 'Install required toolchain?';

    const response = await prompts({
      type: 'confirm',
      name: 'installTools',
      message: installMessage,
    });

    if (!response.installTools) {
      console.log(pc.yellow('Tools installation skipped. Build may fail.'));
      return false;
    }
  }

  try {
    await installTools(language, shouldCleanup);
    return true;
  } catch (error: any) {
    throw new Error(`Failed to install tools: ${error.message}`);
  }
}

/**
 * Get environment with TOOLS_BIN_DIR added to PATH
 */
function getToolsEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (existsSync(TOOLS_BIN_DIR)) {
    env.PATH = `${TOOLS_BIN_DIR}:${env.PATH}`;

    // Set GOROOT to the parent directory of bin if Go is managed by the toolchain
    if (existsSync(join(TOOLS_BIN_DIR, 'go'))) {
      env.GOROOT = join(TOOLS_DIR, 'go');
    }
  }
  return env;
}

/**
 * Install tools using the install-proto-tools.sh script
 */
async function installTools(language: string, shouldCleanup: boolean) {
  const tmpDir = join(TOOLS_DIR, 'download');
  const scriptPath = join(tmpDir, 'install-proto-tools.sh');

  // Make installation idempotent - remove existing tools directory if it exists
  if (shouldCleanup && existsSync(TOOLS_DIR)) {
    try {
      await rm(TOOLS_DIR, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to remove existing tools: ${error}`);
    }
  }

  // Create tools directory structure
  try {
    await mkdir(tmpDir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create temporary directory: ${error}`);
  }

  try {
    try {
      await execa('curl', ['-fsSL', installScriptUrl, '-o', scriptPath]);
    } catch (error) {
      throw new Error(`Failed to download installation script: ${error}`);
    }

    // Make script executable
    await chmod(scriptPath, 0o755);

    // Set up environment variables from tool versions
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      INSTALL_DIR: TOOLS_DIR,
      PRINT_INSTRUCTIONS: 'false',
      LANGUAGE: language,
      INSTALL_COMMON_TOOLS: shouldCleanup ? 'true' : 'false',
    };

    // Store exact versions that we install
    const exactVersions: Record<string, string> = {};

    const toolVersions = LanguageSpecificTools[language];

    // Add version variables to env
    for (const [tool, version] of Object.entries(toolVersions)) {
      env[version.envVar] = version.scriptVersion;
      exactVersions[tool] = version.scriptVersion;
    }

    await execa(scriptPath, [], {
      env,
      stdio: 'inherit',
    });

    // Write the exact versions file
    await writeFile(TOOLS_VERSIONS_FILE, JSON.stringify(exactVersions, null, 2));
  } finally {
    // Clean up
    if (existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return true;
}

/**
 * Generate proto and mapping files from schema
 */
export async function generateProtoAndMapping(pluginDir: string, protoOptions: ProtoOption[], spinner: any) {
  const srcDir = resolve(pluginDir, 'src');
  const generatedDir = resolve(pluginDir, 'generated');

  // Ensure a generated directory exists
  await mkdir(generatedDir, { recursive: true });

  spinner.text = 'Reading schema...';
  const schemaFile = resolve(srcDir, 'schema.graphql');
  const schema = await readFile(schemaFile, 'utf8');
  const lockFile = resolve(generatedDir, 'service.proto.lock.json');

  let lockData: ProtoLock | undefined;

  // check if file exists
  if (existsSync(lockFile)) {
    lockData = JSON.parse(await readFile(lockFile, 'utf8'));
  }

  // Get plugin name from the last segment of the directory path
  const pluginName = basename(pluginDir);

  const serviceName = upperFirst(camelCase(pluginName)) + 'Service';

  // Validate the GraphQL schema and render results
  spinner.text = 'Validating GraphQL schema...';
  const validationResult = validateGraphQLSDL(schema);
  renderValidationResults(validationResult, schemaFile);

  spinner.text = 'Generating mapping and proto files...';

  const mapping = compileGraphQLToMapping(schema, serviceName);
  await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName: 'service',
    protoOptions,
    lockData,
  });

  await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
  await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

  return { serviceName };
}

/**
 * Generate gRPC code using protoc
 */
export async function generateGRPCCode(pluginDir: string, spinner: any, language: string) {
  spinner.text = 'Generating gRPC code...\n';

  const env = getToolsEnv();
  const protocPath = getToolPath('protoc');

  console.log('');

  switch (language) {
    case 'go': {
      await execa(
        protocPath,
        [
          '--go_out=.',
          '--go_opt=paths=source_relative',
          '--go-grpc_out=.',
          '--go-grpc_opt=paths=source_relative',
          'generated/service.proto',
        ],
        { cwd: pluginDir, stdout: 'inherit', stderr: 'inherit', env },
      );
      break;
    }
    case 'ts': {
      const protocGenTsPath = resolve(pluginDir, 'node_modules/.bin/protoc-gen-ts');
      const protoGenJsPath = resolve(pluginDir, 'node_modules/.bin/protoc-gen-js');
      const protocGenGrpcPath = resolve(pluginDir, 'node_modules/.bin/grpc_tools_node_protoc_plugin');
      const generatedDir = resolve(pluginDir, 'generated');
      const protoFile = resolve(pluginDir, 'generated/service.proto');

      if (!existsSync(protocGenTsPath)) {
        throw new Error(`protoc-gen-ts not found at ${protocGenTsPath}.`);
      }
      if (!existsSync(protocGenGrpcPath)) {
        throw new Error(`grpc_tools_node_protoc_plugin not found at ${protocGenGrpcPath}.`);
      }
      if (!existsSync(protoGenJsPath)) {
        throw new Error(`protoc-gen-js not found at ${protoGenJsPath}.`);
      }

      await execa(
        protocPath,
        [
          `--plugin=protoc-gen-ts=${protocGenTsPath}`,
          `--plugin=protoc-gen-grpc=${protocGenGrpcPath}`,
          `--plugin=protoc-gen-js=${protoGenJsPath}`,
          `--ts_out=grpc_js:${generatedDir}`,
          `--js_out=import_style=commonjs,binary:${generatedDir}`,
          `--grpc_out=grpc_js:${generatedDir}`,
          `--proto_path=${generatedDir}`,
          protoFile,
        ],
        { cwd: pluginDir, stdout: 'inherit', stderr: 'inherit', env },
      );

      break;
    }
  }
}

/**
 * Run Go tests
 */
export function runGoTests(pluginDir: string, spinner: any, debug = false) {
  spinner.text = 'Running tests...\n';

  const env = getToolsEnv();
  const goPath = getToolPath('go');

  const args = ['test', './...'];

  if (debug) {
    args.push('-gcflags', 'all=-N -l');
  }

  return execa(goPath, args, {
    cwd: pluginDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
}

export function runTsTests(pluginDir: string, spinner: any) {
  spinner.text = 'Running tests...\n';

  const env = getToolsEnv();
  const bunPath = getToolPath('bun');

  const args = ['test'];

  return execa(bunPath, args, {
    cwd: pluginDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
}

/**
 * Install Go dependencies
 */
export async function installGoDependencies(pluginDir: string, spinner: any) {
  spinner.text = 'Installing dependencies...\n';

  const env = getToolsEnv();
  const goPath = getToolPath('go');

  await execa(goPath, ['mod', 'tidy'], {
    cwd: pluginDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
}

export async function installTsDependencies(pluginDir: string, spinner: any) {
  spinner.text = 'Installing dependencies...\n';

  const env = getToolsEnv();
  const bunPath = getToolPath('bun');

  await execa(bunPath, ['install'], {
    cwd: pluginDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
}

export function getGoModulePathProtoOption(goModulePath: string): ProtoOption {
  return {
    name: 'go_package',
    constant: `"${goModulePath}"`,
  };
}

/**
 * Run TypeScript type-check (no emit) to fail build on TS errors
 */
export async function typeCheckTs(pluginDir: string, spinner: any) {
  spinner.text = 'Type-checking Plugin...\n';

  const env = getToolsEnv();
  const bunPath = getToolPath('bun');

  // Use `bun x tsc` to ensure TypeScript is available without requiring it as a dependency
  await execa(bunPath, ['x', 'tsc', '--noEmit'], {
    cwd: pluginDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
}

/**
 * Build binaries for specified platforms
 */
export async function buildTsBinaries(pluginDir: string, platforms: string[], debug: boolean, spinner: any) {
  spinner.text = 'Building binaries...';

  const binDir = resolve(pluginDir, 'bin');
  await mkdir(binDir, { recursive: true });

  const env = getToolsEnv();
  const bunPath = getToolPath('bun');

  // Ensure grpc-health-check proto is available in bin for runtime
  const healthProtoRelDir = 'grpc-health-check/proto/health/v1';
  const healthProtoFile = 'health.proto';
  await mkdir(resolve(pluginDir, join('bin', healthProtoRelDir)), { recursive: true });
  await copyFile(
    resolve(pluginDir, join('node_modules', healthProtoRelDir, healthProtoFile)),
    resolve(pluginDir, join('bin', healthProtoRelDir, healthProtoFile)),
  );

  await Promise.all(
    platforms.map(async (originalPlatformArch: string) => {
      const platformArch = ALL_BUN_PLATFORM_MAPPINGS[originalPlatformArch];
      if (!platformArch) {
        throw new Error(`Unsupported platform for Bun: ${originalPlatformArch}`);
      }

      const [platform, arch] = platformArch.split('-');
      if (!platform || !arch) {
        throw new Error(
          `Invalid platform-architecture format: ${originalPlatformArch}. Use format like 'bun-darwin-arm64'`,
        );
      }
      const binaryName = `${platform}_${arch}`;

      spinner.text = `Building ${originalPlatformArch}...`;

      if (debug) {
        const debugScript = resolve(pluginDir, join('bin', binaryName));
        await writeFile(debugScript, pupa(TsTemplates.debugBuild, {}));
        await chmod(debugScript, 0o755);
      } else {
        const flags = [
          'build',
          'src/plugin.ts',
          '--compile',
          '--outfile',
          `bin/${binaryName}`,
          `--target=${originalPlatformArch}`,
        ];
        await execa(bunPath, flags, {
          cwd: pluginDir,
          stdout: 'inherit',
          stderr: 'inherit',
          env,
        });
      }
    }),
  );
}

/**
 * Build binaries for specified platforms
 */
export async function buildGoBinaries(pluginDir: string, platforms: string[], debug: boolean, spinner: any) {
  spinner.text = 'Building binaries...';
  const binDir = resolve(pluginDir, 'bin');

  // Ensure bin directory exists
  await mkdir(binDir, { recursive: true });

  const env = getToolsEnv();
  const goPath = getToolPath('go');

  await Promise.all(
    platforms.map(async (platformArch: string) => {
      const [platform, arch] = platformArch.split('-');

      if (!platform || !arch) {
        throw new Error(`Invalid platform-architecture format: ${platformArch}. Use format like 'darwin-arm64'`);
      }

      spinner.text = `Building ${platform}-${arch}...`;

      const binaryName = `${platform}_${arch}`;
      const flags = ['build'];

      if (debug) {
        flags.push('-gcflags', 'all=-N -l');
      }

      flags.push('-o', join(binDir, binaryName), './src');

      await execa(goPath, flags, {
        cwd: pluginDir,
        env: {
          ...env,
          GOOS: platform,
          GOARCH: arch,
          // For better compatibility with different platforms
          CGO_ENABLED: '0',
        },
        stdout: 'inherit',
        stderr: 'inherit',
      });
    }),
  );
}

/**
 * Normalize a platform list based on options
 */
export function normalizePlatforms(platforms: string[], allPlatforms: boolean, language: string): string[] {
  if (platforms.length === 0) {
    platforms = [getHostPlatform(language)];
  }

  if (!allPlatforms) {
    return platforms;
  }

  switch (language) {
    case 'go': {
      return [...new Set([...platforms, ...ALL_GO_PLATFORMS])];
    }
    case 'ts': {
      return [...new Set([...platforms, ...ALL_BUN_PLATFORMS])];
    }
  }

  throw new Error(`Unsupported language for platform normalization: ${language}`);
}

export function getLanguage(pluginDir: string) {
  const goModFile = resolve(pluginDir, 'go.mod');
  const packageJsonFile = resolve(pluginDir, 'package.json');

  if (existsSync(goModFile)) {
    return 'go';
  }

  if (existsSync(packageJsonFile)) {
    return 'ts';
  }

  return null;
}
