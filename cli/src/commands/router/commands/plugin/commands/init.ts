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
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import PluginTemplates from '../templates/plugin.js';
import ProjectTemplates from '../templates/project.js';
import GoTemplates from '../templates/go.js';
import TsTemplates from '../templates/typescript.js';
import { renderResultTree } from '../helper.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('init');
  command.description('Scaffold a new gRPC router plugin');
  command.argument('name', 'Name of the plugin');
  command.option('-p, --project <project>', 'Project name', '');
  command.option('-d, --directory <directory>', 'Directory to create the project in', '.');
  command.option('-l, --language <language>', 'Programming language to use for the plugin', 'go');
  command.action(async (name, options) => {
    const startTime = performance.now();
    const cwd = process.cwd();

    const projectDir = resolve(cwd, options.directory, options.project);

    const pluginDir = options.project ? resolve(cwd, projectDir, 'plugins', name) : resolve(cwd, projectDir, name);

    const originalPluginName = name;

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

      options.language = options.language.toLowerCase();
      if (options.language !== 'go' && options.language !== 'ts') {
        spinner.fail(pc.yellow(`Language '${options.language}' is not supported yet. Using 'go' instead.`));
        options.language = 'go';
      }

      const goModulePath = 'github.com/wundergraph/cosmo/plugin';

      spinner.text = 'Generating mapping and proto files...';

      await writeFile(resolve(srcDir, 'schema.graphql'), pupa(PluginTemplates.schemaGraphql, { name }));
      const mapping = compileGraphQLToMapping(PluginTemplates.schemaGraphql, serviceName);
      await writeFile(resolve(generatedDir, 'mapping.json'), JSON.stringify(mapping, null, 2));
      await writeFile(resolve(tempDir, 'Makefile'), pupa(PluginTemplates.makefile, { originalPluginName }));

      await writeFile(resolve(tempDir, '.gitignore'), PluginTemplates.gitignore);
      await writeFile(resolve(tempDir, '.cursorignore'), PluginTemplates.cursorignore);

      const customOptions = [];
      switch (options.language) {
        case 'go': {
          customOptions.push(`option go_package = "${goModulePath}";`);
          break;
        }
      }

      const proto = compileGraphQLToProto(PluginTemplates.schemaGraphql, {
        serviceName,
        packageName: 'service',
        customOptions,
      });
      await writeFile(resolve(generatedDir, 'service.proto'), proto.proto);
      await writeFile(resolve(generatedDir, 'service.proto.lock.json'), JSON.stringify(proto.lockData, null, 2));

      let readmeTemplate = '';
      let mainFileName = '';

      // Create cursor rules in .cursor/rules
      await mkdir(resolve(tempDir, '.cursor', 'rules'), { recursive: true });

      // Language Specific
      switch (options.language) {
        case 'go': {
          await writeFile(resolve(srcDir, 'main.go'), pupa(GoTemplates.mainGo, { serviceName }));
          await writeFile(resolve(srcDir, 'main_test.go'), pupa(GoTemplates.mainTestGo, { serviceName }));
          await writeFile(resolve(tempDir, 'go.mod'), pupa(GoTemplates.goMod, { modulePath: goModulePath }));
          await writeFile(resolve(tempDir, 'Dockerfile'), pupa(GoTemplates.dockerfile, { originalPluginName }));
          await writeFile(
            resolve(tempDir, '.cursor', 'rules', 'plugin-development.mdc'),
            pupa(GoTemplates.cursorRules, { name, originalPluginName, pluginDir }),
          );
          readmeTemplate = pupa(GoTemplates.readmePartialMd, { originalPluginName });
          mainFileName = 'main.go';
          break;
        }
        case 'ts': {
          await writeFile(resolve(srcDir, 'plugin.ts'), pupa(TsTemplates.pluginTs, { serviceName }));
          await writeFile(resolve(srcDir, 'plugin-server.ts'), pupa(TsTemplates.pluginServerTs, {}));
          await writeFile(resolve(srcDir, 'fs-polyfill.ts'), pupa(TsTemplates.fsPolyfillTs, {}));
          await writeFile(resolve(tempDir, 'package.json'), pupa(TsTemplates.packageJson, { serviceName }));
          await writeFile(resolve(tempDir, 'Dockerfile'), pupa(TsTemplates.dockerfile, { originalPluginName }));
          await writeFile(resolve(srcDir, 'plugin.test.ts'), pupa(TsTemplates.pluginTestTs, { serviceName }));
          await writeFile(resolve(tempDir, 'tsconfig.json'), pupa(TsTemplates.tsconfig, {}));
          await writeFile(
            resolve(tempDir, '.cursor', 'rules', 'plugin-development.mdc'),
            pupa(TsTemplates.cursorRules, { name, originalPluginName, pluginDir, serviceName }),
          );

          const patchDir = resolve(tempDir, 'patches');
          await mkdir(patchDir, { recursive: true });
          await writeFile(resolve(patchDir, 'grpc-health-check@2.1.0.patch'), TsTemplates.grpcHealthCheckFilePatch);

          readmeTemplate = pupa(TsTemplates.readmePartialMd, { originalPluginName });
          mainFileName = 'plugin.ts';
          break;
        }
      }

      if (options.project) {
        await writeFile(
          resolve(tempDir, 'README.md'),
          pupa(ProjectTemplates.readmePluginMd, {
            name,
            originalPluginName,
            mainFile: mainFileName,
            readmeText: readmeTemplate,
          }),
        );

        // Create a project directory structure
        await mkdir(projectDir, { recursive: true });
        await mkdir(resolve(projectDir, 'plugins'), { recursive: true });

        // Write router config to the project root
        await writeFile(resolve(projectDir, 'config.yaml'), ProjectTemplates.routerConfigYaml);
        await writeFile(resolve(projectDir, 'graph.yaml'), pupa(ProjectTemplates.graphYaml, { originalPluginName }));
        await writeFile(resolve(projectDir, 'Makefile'), pupa(ProjectTemplates.makefile, { originalPluginName }));
        await writeFile(resolve(projectDir, '.gitignore'), ProjectTemplates.gitignore);
        await writeFile(
          resolve(projectDir, 'README.md'),
          pupa(ProjectTemplates.readmeProjectMd, { name, originalPluginName }),
        );
      } else {
        await writeFile(
          resolve(tempDir, 'README.md'),
          pupa(PluginTemplates.readmePluginMd, {
            name,
            originalPluginName,
            mainFile: mainFileName,
            readmeText: readmeTemplate,
          }),
        );
        await mkdir(projectDir, { recursive: true });
      }

      await rename(tempDir, pluginDir);

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
        `  You can modify your schema in src/schema.graphql, when you're ready to start implementing, run ${pc.bold('wgc router plugin generate')}.`,
      );
      console.log(
        `  For more information, checkout the ${pc.bold(pc.italic('README.md'))} file for instructions on how to build and run your plugin.`,
      );
      console.log(`  Go to https://cosmo-docs.wundergraph.com/connect/plugins to learn more about it.`);
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
