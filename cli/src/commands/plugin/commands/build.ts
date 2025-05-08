import { Command, program } from 'commander';
import { basename, join, resolve } from 'pathe';
import pc from 'picocolors';
import Spinner from 'ora';
import { access, readFile, writeFile } from 'node:fs/promises';
import spawn from 'nano-spawn';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { compileGraphQLToMapping, compileGraphQLToProto, ProtoLock } from '@wundergraph/protographic';
import os from 'node:os';
import { existsSync } from 'node:fs';

// Define platform-architecture combinations
const HOST_PLATFORM = `${os.platform()}-${os.arch()}`;
const ALL_PLATFORMS = ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64', 'windows-amd64'];

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
  command.action(async (directory, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(directory);

    // Check if the directory exists
    try {
      await access(pluginDir);
    } catch {
      program.error(pc.red(`Directory ${pluginDir} does not exist`));
    }

    const spinner = Spinner({ text: 'Building plugin...' });
    spinner.start();

    try {
      const srcDir = resolve(pluginDir, 'src');
      const generatedDir = resolve(pluginDir, 'generated');
      const binDir = resolve(pluginDir, 'bin');

      // Verify that this is a plugin directory
      try {
        await access(srcDir);
        await access(join(srcDir, 'schema.graphql'));
      } catch {
        throw new Error(`Directory ${pluginDir} does not appear to be a valid plugin directory`);
      }

      // If --all-platforms flag is set, add all platforms to the build targets
      let platforms = [...options.platform];
      if (options.allPlatforms) {
        platforms = [...platforms, ...ALL_PLATFORMS];
        // Remove duplicates
        platforms = [...new Set(platforms)];
      }

      // Generate the proto and mapping files
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
        goPackage: options.goModulePath,
        lockData,
      });
      await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
      await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

      spinner.text = 'Generating gRPC code...';
      await spawn(
        'protoc',
        [
          '--go_out=.',
          '--go_opt=paths=source_relative',
          '--go-grpc_out=.',
          '--go-grpc_opt=paths=source_relative',
          'generated/service.proto',
        ],
        { cwd: pluginDir },
      );

      if (!options.generateOnly) {
        spinner.text = 'Installing dependencies...';
        await spawn('go', ['mod', 'tidy'], { cwd: pluginDir });

        // Build binaries concurrently for each platform-architecture combination
        spinner.text = 'Building binaries...';

        await Promise.all(
          platforms.map(async (platformArch: string) => {
            const [platform, arch] = platformArch.split('-');

            if (!platform || !arch) {
              throw new Error(`Invalid platform-architecture format: ${platformArch}. Use format like 'darwin-arm64'`);
            }

            spinner.text = `Building ${platform}-${arch}...`;

            const binaryName = `${platform}_${arch}`;

            const flags = ['build', '-o', join(binDir, binaryName), 'src/main.go'];

            if (options.debug) {
              flags.push('-gcflags', 'all=-N -l');
            }

            await spawn('go', flags, {
              cwd: pluginDir,
              env: {
                GOOS: platform,
                GOARCH: arch,
                // For better compatibility with different platforms
                CGO_ENABLED: '0',
              },
            });
          }),
        );
      }

      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      if (options.generateOnly) {
        spinner.succeed(pc.green('Generated proto and mapping files successfully!'));
      } else {
        spinner.succeed(pc.green('Plugin built successfully'));
      }

      console.log('\n' + pc.dim('─'.repeat(50)));
      console.log(`${pc.cyan('Location:')} ${pluginDir}`);
      console.log(`${pc.cyan('Time:')} ${formattedTime}`);
      if (!options.generateOnly) {
        console.log(`${pc.cyan('Platforms:')} ${platforms.join(', ')}`);
      }
      console.log(pc.dim('─'.repeat(50)));
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to build plugin: ${error.message}`));
      program.error(`Failed to build plugin: ${error.message}`);
    } finally {
      spinner.stop();
    }
  });

  return command;
};
