import { Command, program } from 'commander';
import { join, resolve } from 'pathe';
import pc from 'picocolors';
import pupa from 'pupa';
import Spinner from 'ora';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { compileGraphQLToMapping, compileGraphQLToProto } from '@wundergraph/protographic';

export default (opts: BaseCommandOptions) => {
  const command = new Command('init');
  command.description('Scaffold a new gRPC router plugin');
  command.argument('name', 'Name of the plugin');
  command.option('-d, --directory <directory>', 'Directory to create the plugin in', '.');
  command.option(
    '--go-module-path <path>',
    'Go module path to use for the plugin',
    'github.com/wundergraph/cosmo/plugin',
  );
  command.action(async (name, options) => {
    const startTime = performance.now();
    const pluginDir = resolve(options.directory, name);
    const __dirname = import.meta.dirname;
    const serviceName = name.charAt(0).toUpperCase() + name.slice(1) + 'Service';

    // Check if a directory exists
    try {
      await access(pluginDir);
      program.error(pc.red(`Plugin ${name} already exists in ${pluginDir}`));
    } catch {
      // Directory doesn't exist, we can proceed
    }

    const spinner = Spinner({ text: 'Creating plugin...' });

    spinner.start();

    try {
      spinner.text = 'Creating directories...';

      await mkdir(pluginDir, { recursive: true });
      const srcDir = resolve(pluginDir, 'src');
      await mkdir(srcDir, { recursive: true });
      const generatedDir = resolve(pluginDir, 'generated');
      await mkdir(generatedDir, { recursive: true });

      spinner.text = 'Creating files...';

      const readme = await readFile(resolve(__dirname, '..', 'templates/README.md'), 'utf-8');
      await writeFile(resolve(pluginDir, 'README.md'), pupa(readme, { name }));

      const schema = await readFile(resolve(__dirname, '..', 'templates/schema.graphql'), 'utf-8');
      await writeFile(resolve(srcDir, 'schema.graphql'), pupa(schema, { name }));

      const mapping = compileGraphQLToMapping(schema, serviceName);
      await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

      const proto = compileGraphQLToProto(schema, {
        serviceName,
        packageName: 'service',
        goPackage: options.goModulePath,
      });
      await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
      await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

      const mainGo = await readFile(resolve(__dirname, '..', 'templates/main.go'), 'utf-8');
      await writeFile(resolve(srcDir, 'main.go'), mainGo);

      // go mod init
      const goMod = await readFile(resolve(__dirname, '..', 'templates/go.mod'), 'utf-8');
      await writeFile(resolve(pluginDir, 'go.mod'), pupa(goMod, { modulePath: options.goModulePath }));

      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      spinner.succeed(pc.green(`Plugin ${pc.bold(name)} scaffolded successfully!`));

      console.log('\n' + pc.dim('─'.repeat(50)));
      console.log(`${pc.cyan('Location:')} ${pluginDir}`);
      console.log(`${pc.cyan('Time:')} ${formattedTime}`);
      console.log(`${pc.cyan('Next steps:')}`);
      console.log(`  Go to https://cosmo-docs.wundergraph.com/router/plugins to learn more about.`);

      // Use relative path for the build command
      const buildPath = options.directory === '.' ? name : join(options.directory, name);
      console.log(`  3. Run '${pc.bold(`wgc plugin build ${buildPath}`)}'`);

      console.log(pc.dim('─'.repeat(50)));
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to create plugin: ${error.message}`));
      program.error(`Failed to create plugin: ${error.message}`);
    } finally {
      spinner.stop();
    }
  });

  return command;
};
