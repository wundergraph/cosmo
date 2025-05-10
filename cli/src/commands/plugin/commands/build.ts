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

// Define platform-architecture combinations
const HOST_PLATFORM = `${os.platform()}-${os.arch()}`;
const ALL_PLATFORMS = ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64', 'windows-amd64'];

// Get paths for tool installation
const TOOLS_DIR = join(dataDir, 'proto-tools');
const TOOLS_BIN_DIR = join(TOOLS_DIR, 'bin');
const TOOLS_VERSIONS_FILE = join(TOOLS_DIR, 'versions.json');

// Tool versions configuration
const TOOL_VERSIONS = {
  protoc: '21.12',
  protocGenGo: 'v1.28.1',
  protocGenGoGrpc: 'v1.2.0',
  go: '1.21.0',
};

// Mapping between tool names and environment variable names
const TOOL_ENV_VARS = {
  protoc: 'PROTOC_VERSION',
  protocGenGo: 'PROTOC_GEN_GO_VERSION',
  protocGenGoGrpc: 'PROTOC_GEN_GO_GRPC_VERSION',
  go: 'GO_VERSION',
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

  // If the tools directory doesn't exist, we need to install
  if (!existsSync(TOOLS_DIR) || !existsSync(TOOLS_BIN_DIR)) {
    return true;
  }

  // If a version file doesn't exist, we need to install
  if (!existsSync(TOOLS_VERSIONS_FILE)) {
    return true;
  }

  try {
    // Read stored versions and compare with current versions
    const storedVersionsStr = await readFile(TOOLS_VERSIONS_FILE, 'utf-8');
    const storedVersions = JSON.parse(storedVersionsStr) as Record<string, string>;

    // Compare each tool version
    for (const [tool, version] of Object.entries(TOOL_VERSIONS)) {
      if (storedVersions[tool] !== version) {
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

/**
 * Check if tools need installation and ask user if needed
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

  const response = await prompts({
    type: 'confirm',
    name: 'installTools',
    message: installMessage,
    initial: true,
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
    // Download the script from GitHub
    const scriptUrl =
      'https://raw.githubusercontent.com/wundergraph/cosmo/refs/heads/ludwig/eng-6940-router-go-plugin-host-system/scripts/install-proto-tools.sh';

    try {
      await execa('curl', ['-fsSL', scriptUrl, '-o', scriptPath]);
    } catch (error) {
      throw new Error(`Failed to download installation script: ${error}`);
    }

    // Make script executable
    await chmod(scriptPath, 0o755);

    // Set up environment variables from tool versions
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      INSTALL_DIR: TOOLS_DIR,
    };

    // Add version variables to env
    for (const [tool, envVar] of Object.entries(TOOL_ENV_VARS)) {
      env[envVar] = TOOL_VERSIONS[tool as keyof typeof TOOL_VERSIONS];
    }

    await execa(scriptPath, [], {
      env,
      stdio: 'inherit',
    });

    // Write the complete versions file
    await writeFile(TOOLS_VERSIONS_FILE, JSON.stringify(TOOL_VERSIONS, null, 2));
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
