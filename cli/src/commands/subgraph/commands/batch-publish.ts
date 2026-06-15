import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'pathe';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import yaml from 'js-yaml';
import { z } from 'zod';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { handleCompositionResult } from '../../../handle-composition-result.js';
import { limitMaxValue } from '../../../constants.js';
import { fileExists } from '../../../utils.js';
import { poolBatchPublishStatus } from '../utils/pool-batch-publish-status.js';

const entrySchema = z.object({
  name: z.string().trim().min(1, 'a non-empty "name" is required'),
  schema: z.string().trim().min(1, 'a non-empty "schema" file path is required'),
});

// Regular subgraphs and feature subgraphs are listed together; feature subgraphs are detected by the control plane.
const configSchema = z.object({
  subgraphs: z.array(entrySchema).min(1, 'at least one subgraph is required'),
});

type BatchPublishEntry = z.infer<typeof entrySchema>;

export default (opts: BaseCommandOptions) => {
  const command = new Command('batch-publish');
  command.description(
    'Publishes the schemas of multiple subgraphs at once using a config file.\n' +
      'All subgraphs and feature subgraphs listed in the config must already exist.\n' +
      'Any composition errors are reported per federated graph, and the router keeps serving the last valid schema.',
  );
  command.requiredOption(
    '-c, --config <path-to-config>',
    'The path to the YAML config file listing the subgraphs and feature subgraphs to publish.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the subgraphs.');
  command.option(
    '--fail-on-composition-error',
    'If set, the command will fail if the composition of any federated graph fails.',
    false,
  );
  command.option(
    '--fail-on-admission-webhook-error',
    'If set, the command will fail if the admission webhook fails.',
    false,
  );
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );
  command.option(
    '-l, --limit <number>',
    'The maximum number of composition errors, warnings, and deployment errors to display.',
    '50',
  );
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.option('--async', 'This flag enable pooling for the publish status');

  command.action(async (options) => {
    const configFile = resolve(options.config);
    if (!(await fileExists(configFile))) {
      program.error(
        pc.red(
          pc.bold(`The config file '${pc.bold(configFile)}' does not exist. Please check the path and try again.`),
        ),
      );
    }

    let rawConfig: unknown;
    try {
      // YAML is a superset of JSON, so this parses both formats.
      rawConfig = yaml.load(new TextDecoder().decode(await readFile(configFile))) ?? {};
    } catch (e: any) {
      program.error(pc.red(pc.bold(`Failed to parse the config file '${configFile}': ${e.message}`)));
    }

    const parsed = configSchema.safeParse(rawConfig);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      program.error(pc.red(pc.bold(`The config file '${configFile}' is invalid:\n${details}`)));
    }

    const { subgraphs: subgraphEntries } = parsed.data;

    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > limitMaxValue) {
      program.error(
        pc.red(`The limit must be a valid number between 1 and ${limitMaxValue}. Received: '${options.limit}'`),
      );
    }

    // Resolve and read each schema file relative to the config file's directory.
    const configDir = dirname(configFile);
    const readEntries = (entries: BatchPublishEntry[]) =>
      Promise.all(
        entries.map(async (entry) => {
          const schemaFile = resolve(configDir, entry.schema);
          if (!(await fileExists(schemaFile))) {
            program.error(
              pc.red(
                pc.bold(
                  `The schema file '${pc.bold(schemaFile)}' for subgraph '${entry.name}' does not exist. Please check the path and try again.`,
                ),
              ),
            );
          }
          const schema = new TextDecoder().decode(await readFile(schemaFile));
          if (schema.trim().length === 0) {
            program.error(
              pc.red(pc.bold(`The schema file '${pc.bold(schemaFile)}' for subgraph '${entry.name}' is empty.`)),
            );
          }
          return { name: entry.name, schema };
        }),
      );

    const subgraphs = await readEntries(subgraphEntries);

    const shouldOutputJson = options.json || options.raw;
    const spinner = ora('Subgraphs are being published...');
    if (!shouldOutputJson) {
      spinner.start();
    }

    let resp = await opts.client.platform.publishFederatedSubgraphs(
      {
        namespace: options.namespace,
        subgraphs,
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        limit,
        async: options.async,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.jobId) {
      resp = await poolBatchPublishStatus(opts.client, resp.jobId);
    }

    const total = subgraphs.length;
    const changed = resp.updatedSubgraphNames?.length ?? 0;

    handleCompositionResult({
      responseCode: resp.response?.code,
      responseDetails: resp.response?.details,
      compositionErrors: resp.compositionErrors,
      compositionWarnings: resp.compositionWarnings,
      deploymentErrors: resp.deploymentErrors,
      totalErrorCounts: resp.counts,
      spinner,
      successMessage: `Successfully published ${total} subgraph${total === 1 ? '' : 's'} (${changed} changed).`,
      subgraphCompositionBaseErrorMessage: 'The schemas were published, but with composition errors.',
      subgraphCompositionDetailedErrorMessage:
        'There were composition errors when composing the affected federated graphs.\nThe router will continue to work with the latest valid schema.\n',
      deploymentErrorMessage:
        'The schemas were published, but the updated composition could not be deployed.\nThis means the updated composition will not be accessible to the router.\n',
      defaultErrorMessage: 'Failed to publish the subgraphs.',
      shouldOutputJson,
      suppressWarnings: options.suppressWarnings,
      failOnCompositionError: options.failOnCompositionError,
      failOnCompositionErrorMessage: `The publish was successful, but the command failed because composition errors were produced.`,
      failOnAdmissionWebhookError: options.failOnAdmissionWebhookError,
      failOnAdmissionWebhookErrorMessage: `The publish was successful, but the command failed because the admission webhook failed.`,
    });
  });

  return command;
};
