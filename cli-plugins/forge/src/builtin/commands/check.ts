import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { configFileName } from '@wundergraph/wgc-plugin-sdk/config';
import type { Command } from 'commander';
import { checkGraph, ruleIds } from '../check/check.js';
import type { CheckReport } from '../check/check.js';
import type { ExceptedFinding, Finding } from '../check/findings.js';
import { loadSubgraphs } from '../check/subgraphs.js';
import { readConfig } from '../workspace.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

const indent = '      ';

const renderFinding = (label: string, finding: Finding | ExceptedFinding): string => {
  const lines = [`${label.padEnd(4)}  ${finding.rule}  ${finding.coordinate}`];

  if (finding.location !== undefined) {
    lines.push(`${indent}${finding.location.file}:${finding.location.line}:${finding.location.column}`);
  }
  if (finding.found !== undefined) {
    lines.push(`${indent}Found     ${finding.found}`);
  }
  if (finding.expected !== undefined) {
    lines.push(`${indent}Expected  ${finding.expected}`);
  }
  if (finding.reference !== undefined) {
    lines.push(`${indent}Example   ${finding.reference.coordinate} in ${finding.reference.file}`);
  }
  lines.push(`${indent}${finding.message}`);
  if ('reason' in finding) {
    lines.push(`${indent}Exception: ${finding.reason}`);
  }

  return lines.join('\n');
};

const renderReport = (report: CheckReport): string => {
  const { errors, warnings, exceptions, subgraphs } = report.summary;

  return [
    ...report.compositionErrors.map((error) => `FAIL  composition\n${indent}${error}`),
    ...report.findings.map((finding) => renderFinding(finding.severity === 'error' ? 'FAIL' : 'WARN', finding)),
    ...report.exceptions.map((finding) => renderFinding('SKIP', finding)),
    `${errors} error(s), ${warnings} warning(s), ${exceptions} exception(s) in ${subgraphs} subgraph(s).`,
  ].join('\n');
};

export const registerCheck = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('check')
      .description(
        `Check the subgraphs of ${configFileName} against the API design rules. Exits 3 on a blocking finding or when the graph does not compose.`,
      )
      .addHelpText(
        'after',
        [
          '',
          `Rules are set under \`check.rules\` in ${configFileName} as <rule>: error | warn | off.`,
          'A finding of an `error` rule blocks. Approved exceptions go under `check.exceptions` as',
          '{ rule, coordinate, reason } and are reported apart from the open findings.',
          '',
          'Rules:',
          ...ruleIds().map((id) => `  ${id}`),
        ].join('\n'),
      ),
  ).action(async (options: CommonOptions) => {
    const output = dependencies.context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const config = await readConfig(workspace);
    if (!config.success) {
      return output.fail(toFailure(config));
    }
    const policy = config.data.check ?? {};

    const unknownRule = Object.keys(policy.rules ?? {}).find((rule) => !ruleIds().includes(rule));
    if (unknownRule !== undefined) {
      return output.fail({
        message: `${configFileName} sets a rule that does not exist: ${unknownRule}.`,
        input: `${configFileName}: check.rules.${unknownRule}`,
        remediation: 'Run `wgc forge check --help` to list the rules.',
      });
    }

    const subgraphs = await loadSubgraphs(workspace, config.data.subgraphs, dependencies.system);
    if (!subgraphs.success) {
      return output.fail(toFailure(subgraphs));
    }

    const report = checkGraph(subgraphs.data, policy);

    if (!report.complete) {
      return output.fail(
        {
          kind: 'findings',
          message: 'The check is incomplete: the graph does not compose.',
          input: `${configFileName}: subgraphs`,
          remediation: 'Fix the composition errors, then run the check again.',
          data: report,
        },
        (data) => `${renderReport(data)}\nThe check is incomplete: the graph does not compose.`,
      );
    }

    if (report.summary.errors > 0) {
      return output.fail(
        {
          kind: 'findings',
          message: `The check found ${report.summary.errors} blocking finding(s).`,
          input: `${configFileName}: subgraphs`,
          remediation: `Repair each finding, or record an approved exception under \`check.exceptions\` in ${configFileName}.`,
          data: report,
        },
        renderReport,
      );
    }

    output.result(report, renderReport);
  });
};
