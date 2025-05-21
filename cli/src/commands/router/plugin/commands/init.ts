/* eslint-disable import/no-named-as-default-member */

import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import pupa from 'pupa';
import Spinner from 'ora';
import { compileGraphQLToMapping, compileGraphQLToProto } from '@wundergraph/protographic';
import { camelCase, upperFirst } from 'lodash-es';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import SimpleGoPlugin from '../templates/simple-go-plugin.js';
import FullGoPlugin from '../templates/full-go-plugin.js';
import { renderResultTree } from '../helper.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('init');
  command.description('Scaffold a new gRPC router plugin');
  command.argument('name', 'Name of the plugin');
  command.option('-p, --project <project>', 'Project name', 'cosmo');
  command.option('-d, --directory <directory>', 'Directory to create the project in', '.');
  command.option('--plugin-only', 'Only create the plugin, not the project');
  command.option('-l, --language <language>', 'Programming language to use for the plugin', 'go');
  command.action(async (name, options) => {
    const startTime = performance.now();
    const cwd = process.cwd();

    if (options.pluginOnly) {
      options.project = '';
    }

    const projectDir = resolve(cwd, options.directory, options.project);
    const pluginDir = resolve(cwd, projectDir, 'plugins', name);
    const originalPluginName = name;

    console.log(projectDir);

    name = upperFirst(camelCase(name));
    const serviceName = name + 'Service';

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

      const goModulePath = 'github.com/wundergraph/cosmo/plugin';

      spinner.text = 'Generating mapping and proto files...';

      if (options.project) {
        await writeFile(resolve(tempDir, 'README.md'), pupa(FullGoPlugin.readme, { name, originalPluginName }));
        await writeFile(resolve(srcDir, 'schema.graphql'), pupa(FullGoPlugin.schema, { name }));

        const mapping = compileGraphQLToMapping(FullGoPlugin.schema, serviceName);
        await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

        const proto = compileGraphQLToProto(FullGoPlugin.schema, {
          serviceName,
          packageName: 'service',
          goPackage: goModulePath,
        });

        await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
        await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

        await writeFile(resolve(srcDir, 'main.go'), pupa(FullGoPlugin.mainGo, { serviceName }));
        await writeFile(resolve(srcDir, 'main_test.go'), pupa(FullGoPlugin.mainGoTest, { serviceName }));

        await writeFile(resolve(tempDir, 'go.mod'), pupa(FullGoPlugin.goMod, { modulePath: goModulePath }));

        // Create project directory structure
        await mkdir(projectDir, { recursive: true });
        await mkdir(resolve(projectDir, 'plugins'), { recursive: true });

        // Write router config to project root
        await writeFile(resolve(projectDir, 'config.yaml'), FullGoPlugin.routerConfig);
        await writeFile(resolve(projectDir, 'graph.yaml'), pupa(FullGoPlugin.graphConfig, { originalPluginName }));
        await writeFile(resolve(projectDir, 'Makefile'), pupa(FullGoPlugin.makefile, { originalPluginName }));
        await writeFile(
          resolve(projectDir, 'README.md'),
          pupa(FullGoPlugin.projectReadme, { name, originalPluginName }),
        );

        // Move plugin from temp directory to project plugins directory
        await rename(tempDir, pluginDir);
      } else {
        await writeFile(resolve(tempDir, 'README.md'), pupa(SimpleGoPlugin.readme, { name, originalPluginName }));
        await writeFile(resolve(srcDir, 'schema.graphql'), pupa(SimpleGoPlugin.schema, { name }));

        const mapping = compileGraphQLToMapping(SimpleGoPlugin.schema, serviceName);
        await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));

        const proto = compileGraphQLToProto(SimpleGoPlugin.schema, {
          serviceName,
          packageName: 'service',
          goPackage: goModulePath,
        });

        await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
        await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

        await writeFile(resolve(srcDir, 'main.go'), pupa(SimpleGoPlugin.mainGo, { serviceName }));
        await writeFile(resolve(srcDir, 'main_test.go'), pupa(SimpleGoPlugin.mainGoTest, { serviceName }));

        await writeFile(resolve(tempDir, 'go.mod'), pupa(SimpleGoPlugin.goMod, { modulePath: goModulePath }));

        await mkdir(resolve(projectDir, 'plugins'), { recursive: true });

        await rename(tempDir, pluginDir);
      }

      const endTime = performance.now();
      const elapsedTimeMs = endTime - startTime;
      const formattedTime =
        elapsedTimeMs > 1000 ? `${(elapsedTimeMs / 1000).toFixed(2)}s` : `${Math.round(elapsedTimeMs)}ms`;

      renderResultTree(spinner, 'Plugin scaffolded!', true, name, {
        language: options.language,
        time: formattedTime,
        location: pluginDir,
      });
      console.log('');
      console.log(
        `  Checkout the ${pc.bold(pc.italic('README.md'))} file for instructions on how to build and run your plugin.`,
      );
      console.log(`  Go to https://cosmo-docs.wundergraph.com/router/plugins to learn more about it.`);
      console.log('');
    } catch (error: any) {
      // Clean up the temp directory in case of error
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      renderResultTree(spinner, 'Plugin scaffolding', false, name, {
        error: error.message,
      });
    } finally {
      spinner.stop();
    }
  });

  return command;
};
