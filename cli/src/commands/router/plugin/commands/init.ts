import { Command, program } from 'commander';
import { relative, resolve } from 'pathe';
import pc from 'picocolors';
import pupa from 'pupa';
import Spinner from 'ora';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { goMod, mainGo, mainGoTest, readme, schema } from '../templates/go-plugin.js';
import { compileGraphQLToMapping, compileGraphQLToProto } from '@wundergraph/protographic';

export default (opts: BaseCommandOptions) => {
  const command = new Command('init');
  command.description('Scaffold a new gRPC router plugin');
  command.argument('name', 'Name of the plugin');
  command.option('-d, --directory <directory>', 'Directory to create the plugin in', '.');
  command.option('-l, --language <language>', 'Programming language to use for the plugin', 'go');
  command.action(async (name, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(process.cwd(), options.directory, name);
    const serviceName = name.charAt(0).toUpperCase() + name.slice(1) + 'Service';

    // Check if a directory exists
    try {
      await access(pluginDir);
      program.error(pc.red(`Plugin ${name} already exists in ${pluginDir}`));
    } catch {
      // Directory doesn't exist, we can proceed
    }

    const spinner = Spinner({ text: 'Creating plugin...' });
    // Create a temporary directory
    const tempDir = resolve(tmpdir(), `cosmo-plugin-${randomUUID()}`);

    spinner.start();

    try {
      spinner.text = 'Creating directories...';

      await mkdir(tempDir, { recursive: true });
      const srcDir = resolve(tempDir, 'src');
      await mkdir(srcDir, { recursive: true });
      const generatedDir = resolve(tempDir, 'generated');
      await mkdir(generatedDir, { recursive: true });

      spinner.text = 'Checkout templates...';

      if (options.language.toLowerCase() !== 'go') {
        spinner.fail(pc.yellow(`Language '${options.language}' is not supported yet. Using 'go' instead.`));
        options.language = 'go';
      }

      await writeFile(resolve(tempDir, 'README.md'), pupa(readme, { name }));
      await writeFile(resolve(srcDir, 'schema.graphql'), pupa(schema, { name }));

      spinner.text = 'Generating mapping and proto files...';

      const mapping = compileGraphQLToMapping(schema, serviceName);
      await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

      const goModulePath = 'github.com/wundergraph/cosmo/plugin';

      const proto = compileGraphQLToProto(schema, {
        serviceName,
        packageName: 'service',
        goPackage: goModulePath,
      });
      await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
      await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

      await writeFile(resolve(srcDir, 'main.go'), pupa(mainGo, { serviceName }));
      await writeFile(resolve(srcDir, 'main_test.go'), pupa(mainGoTest, { serviceName }));

      // go mod init
      await writeFile(resolve(tempDir, 'go.mod'), pupa(goMod, { modulePath: goModulePath }));

      await mkdir(resolve(process.cwd(), options.directory), { recursive: true });
      await rename(tempDir, pluginDir);

      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      spinner.succeed(pc.green(`Plugin ${pc.bold(name)} scaffolded successfully! ` + `[${formattedTime}]`));
      console.log('');
      console.log(
        `  Checkout the ${pc.bold(pc.italic(relative(process.cwd(), resolve(pluginDir, 'README.md'))))} file for instructions on how to build and run your plugin.`,
      );
      console.log(`  Go to https://cosmo-docs.wundergraph.com/router/plugins to learn more about it.`);
      console.log('');
    } catch (error: any) {
      // Clean up the temp directory in case of error
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      spinner.fail(pc.red(`Failed to init plugin: ${error.message}`));
      throw error;
    } finally {
      spinner.stop();
    }
  });

  return command;
};
