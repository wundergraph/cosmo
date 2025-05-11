import { Command, program } from 'commander';
import { basename, join, resolve } from 'pathe';
import pc from 'picocolors';
import Spinner from 'ora';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import os from 'node:os';
import { existsSync } from 'node:fs';
import prompts from 'prompts';
import { dataDir } from '../../../core/config';
import semver from 'semver';

// Define platform-architecture combinations
const HOST_PLATFORM = `${os.platform()}-${os.arch()}`;
const ALL_PLATFORMS = ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64', 'windows-amd64'];
const installScriptUrl =
  'https://raw.githubusercontent.com/wundergraph/cosmo/refs/heads/ludwig/eng-6940-router-go-plugin-host-system/scripts/install-proto-tools.sh';

// Get paths for tool installation
const TOOLS_DIR = join(dataDir, 'proto-tools');
const TOOLS_BIN_DIR = join(TOOLS_DIR, 'bin');
const TOOLS_VERSIONS_FILE = join(TOOLS_DIR, 'versions.json');

// Exact tool versions to be installed for the script, but you can specify a semver range to express compatibility
// The version needs to match with the download URL in the install-proto-tools.sh script
const TOOL_VERSIONS = {
  protoc: { version: '~29.3', envVar: 'PROTOC_VERSION' },
  protocGenGo: { version: '~1.34.2', envVar: 'PROTOC_GEN_GO_VERSION' },
  protocGenGoGrpc: { version: '~1.5.1', envVar: 'PROTOC_GEN_GO_GRPC_VERSION' },
  go: { version: '>=1.22.0', envVar: 'GO_VERSION' },
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('build');
  command.description('Build a gRPC router plugin');
  command.argument('[directory]', 'Directory of the plugin', '.');
  command.option('--generate-only', 'Generate only the proto and mapping files, do not compile the plugin');
  command.option(
    '--go-module-path <path>',
    'Go module path to use for the plugin',
    'github.com/wundergraph/cosmo/plugin',
  );
  command.option('--debug', 'Build the binary with debug information');
  command.option('--platform [platforms...]', 'Platform-architecture combinations (e.g., darwin-arm64 linux-amd64)', [
    HOST_PLATFORM,
  ]);
  command.option('--all-platforms', 'Build for all supported platforms', false);
  command.option('--skip-tools-installation', 'Skip tool installation', false);
  command.option(
    '--force-tools-installation',
    'Force tools installation regardless of version check or confirmation',
    false,
  );

  command.action(async (directory, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(directory);
    const spinner = Spinner();

    try {
      // Check and install tools if needed
      if (!options.skipToolsInstallation) {
        await checkAndInstallTools(options.forceToolsInstallation);
      }

      // Normalize platform list
      const platforms = normalizePlatforms(options.platform, options.allPlatforms);

      // Start the main build process
      spinner.start('Building plugin...');

      // Generate proto and mapping files
      await generateProtoAndMapping(pluginDir, options.goModulePath, spinner);

      // Generate gRPC code
      await generateGRPCCode(pluginDir, spinner);

      if (!options.generateOnly) {
        // Install Go dependencies
        await installGoDependencies(pluginDir, spinner);

        // Build binaries for all platforms
        await buildBinaries(pluginDir, platforms, options.debug, spinner);
      }

      // Calculate and format elapsed time
      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      if (options.generateOnly) {
        spinner.succeed(pc.green('Generated proto and mapping files successfully! ' + `[${formattedTime}]`));
      } else {
        spinner.succeed(pc.green('Plugin built successfully! ' + `[${formattedTime}]`));
      }
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to build plugin: ${error.message}`));
      program.error(`Failed to build plugin: ${error.message}`);
    } finally {
      spinner.stop();
    }
  });

  return command;
};

/**
 * Get the path to a tool, preferring the installed version if available
 */
function getToolPath(toolName: string): string {
  return existsSync(join(TOOLS_BIN_DIR, toolName)) ? join(TOOLS_BIN_DIR, toolName) : toolName;
}

/**
 * Check if tools need to be reinstalled by comparing version matrices
 */
async function shouldReinstallTools(force = false): Promise<boolean> {
  // If forcing reinstallation, return true
  if (force) {
    return true;
  }

  // If a version file exists, we assume the user manages the tools via toolchain
  if (existsSync(TOOLS_VERSIONS_FILE)) {
    try {
      // Read stored versions and compare with current versions
      const storedVersionsStr = await readFile(TOOLS_VERSIONS_FILE, 'utf-8');
      const storedVersions = JSON.parse(storedVersionsStr) as Record<string, string>;

      // Compare each tool version
      for (const [tool, version] of Object.entries(TOOL_VERSIONS)) {
        // Check if the stored exact version satisfies the required range
        if (!storedVersions[tool] || !isSemverSatisfied(storedVersions[tool], version.version)) {
          return true;
        }
      }

      // Check for any new tools that weren't in the stored versions
      for (const tool of Object.keys(TOOL_VERSIONS)) {
        if (!(tool in storedVersions)) {
          return true;
        }
      }

      // If we got here, all versions match
      return false;
    } catch (error) {
      // If any error occurs during version checking, assume reinstallation is needed
      return true;
    }
  }

  // if we haven't installed the tools yet, we check first if the tools are installed on the host system,
  // and if they are not, we need to install them through the toolchain installation
  try {
    const toolsOnHost = await areToolsInstalledOnHost();
    if (toolsOnHost) {
      return false;
    }
    return true;
  } catch (error) {
    // If error checking host tools, installation is needed
    return true;
  }
}

/**
 * Check if all required tools are installed on the host system with correct versions
 */
async function areToolsInstalledOnHost(): Promise<boolean> {
  try {
    // Check Go version
    const goVersion = await getCommandVersion('go', 'version');
    if (!isSemverSatisfied(goVersion, TOOL_VERSIONS.go.version)) {
      console.log(pc.yellow(`Go version mismatch: found ${goVersion}, required ${TOOL_VERSIONS.go.version}`));
      return false;
    }

    // Check Protoc version
    const protocVersion = await getCommandVersion('protoc', '--version');
    if (!isSemverSatisfied(protocVersion, TOOL_VERSIONS.protoc.version)) {
      console.log(
        pc.yellow(`Protoc version mismatch: found ${protocVersion}, required ${TOOL_VERSIONS.protoc.version}`),
      );
      return false;
    }

    // Check protoc-gen-go version
    // The output format is typically "protoc-gen-go v1.36.5"
    const protocGenGoVersion = await getCommandVersion('protoc-gen-go', '--version');
    if (!isSemverSatisfied(protocGenGoVersion, TOOL_VERSIONS.protocGenGo.version)) {
      console.log(
        pc.yellow(
          `protoc-gen-go version mismatch: found ${protocGenGoVersion}, required ${TOOL_VERSIONS.protocGenGo.version}`,
        ),
      );
      return false;
    }

    // Check protoc-gen-go-grpc version
    // The output format is typically "protoc-gen-go-grpc 1.5.1"
    const protocGenGoGrpcVersion = await getCommandVersion('protoc-gen-go-grpc', '--version');
    if (!isSemverSatisfied(protocGenGoGrpcVersion, TOOL_VERSIONS.protocGenGoGrpc.version)) {
      console.log(
        pc.yellow(
          `protoc-gen-go-grpc version mismatch: found ${protocGenGoGrpcVersion}, required ${TOOL_VERSIONS.protocGenGoGrpc.version}`,
        ),
      );
      return false;
    }

    return true;
  } catch (error: any) {
    console.log(pc.yellow(`Error checking tools: ${error.message}`));
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
  } catch (error) {
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

  const versionRegex = /[vV]?(\d+(?:\.\d+){1,2})/;

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

/**
 * Check if tools need installation and ask the user if needed
 */
async function checkAndInstallTools(force = false): Promise<boolean> {
  const needsReinstall = await shouldReinstallTools(force);

  if (!needsReinstall) {
    return true;
  }

  // Ask user for confirmation to install tools
  const installMessage = existsSync(TOOLS_DIR)
    ? 'Version changes detected. Install required toolchain?'
    : 'Install required toolchain?';

  // Create a more informative message with simple formatting
  const toolsInfo = Object.entries(TOOL_VERSIONS)
    .map(([tool, { version }]) => `  ${pc.cyan('•')} ${pc.bold(tool)}: ${version}`)
    .join('\n');

  console.log(
    pc.yellow('\n=== Required Toolchain ===') +
      '\n\n' +
      pc.white('The following tools are needed to build the router plugin:') +
      '\n\n' +
      toolsInfo +
      '\n\n' +
      pc.white('You can install them automatically or manually install them yourself') +
      '\n' +
      pc.white('by following the documentation at https://cosmo-docs.wundergraph.com') +
      '\n',
  );

  const response = await prompts({
    type: 'confirm',
    name: 'installTools',
    message: installMessage,
  });

  if (!response.installTools) {
    console.log(pc.yellow('Tools installation skipped. Build may fail.'));
    return false;
  }

  try {
    await installTools();
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
  }
  return env;
}

/**
 * Install tools using the install-proto-tools.sh script
 */
async function installTools() {
  const tmpDir = join(TOOLS_DIR, 'download');
  const scriptPath = join(tmpDir, 'install-proto-tools.sh');

  // Make installation idempotent - remove existing tools directory if it exists
  if (existsSync(TOOLS_DIR)) {
    try {
      await rm(TOOLS_DIR, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to remove existing tools: ${error}`);
    }
  }

  // Create tools directory structure
  try {
    await execa('mkdir', ['-p', tmpDir]);
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
    };

    // Store exact versions that we install
    const exactVersions: Record<string, string> = {};

    // Add version variables to env
    for (const [tool, version] of Object.entries(TOOL_VERSIONS)) {
      // The scripts work with all versions without the prefix or semver range
      const v = version.version.replace(/^[v~^>=<]+/, '');

      if (!v) {
        throw new Error(`Invalid version ${version.version} for ${tool}`);
      }

      env[version.envVar] = v;
      exactVersions[tool] = v;
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
async function generateProtoAndMapping(pluginDir: string, goModulePath: string, spinner: any) {
  const srcDir = resolve(pluginDir, 'src');
  const generatedDir = resolve(pluginDir, 'generated');

  spinner.text = 'Reading schema...';
  const schema = await readFile(resolve(srcDir, 'schema.graphql'), 'utf-8');
  const lockFile = resolve(generatedDir, 'service.proto.lock.json');

  let lockData: ProtoLock | undefined;

  // check if file exists
  if (existsSync(lockFile)) {
    lockData = JSON.parse(await readFile(lockFile, 'utf-8'));
  }

  // Get plugin name from the last segment of the directory path
  const pluginName = basename(pluginDir);
  const serviceName = pluginName.charAt(0).toUpperCase() + pluginName.slice(1) + 'Service';

  spinner.text = 'Generating mapping and proto files...';

  const mapping = compileGraphQLToMapping(schema, serviceName);
  await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

  const proto = compileGraphQLToProto(schema, {
    serviceName,
    packageName: 'service',
    goPackage: goModulePath,
    lockData,
  });

  await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
  await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

  return { serviceName };
}

/**
 * Generate gRPC code using protoc
 */
async function generateGRPCCode(pluginDir: string, spinner: any) {
  spinner.text = 'Generating gRPC code...';

  const env = getToolsEnv();
  const protocPath = getToolPath('protoc');

  console.log('');

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
}

/**
 * Install Go dependencies
 */
async function installGoDependencies(pluginDir: string, spinner: any) {
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

/**
 * Build binaries for specified platforms
 */
async function buildBinaries(pluginDir: string, platforms: string[], debug: boolean, spinner: any) {
  spinner.text = 'Building binaries...';
  const binDir = resolve(pluginDir, 'bin');
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

      flags.push('-o', join(binDir, binaryName), 'src/main.go');

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
function normalizePlatforms(platforms: string[], allPlatforms: boolean): string[] {
  if (!allPlatforms) {
    return platforms;
  }

  // Add all platforms and remove duplicates
  return [...new Set([...platforms, ...ALL_PLATFORMS])];
}
