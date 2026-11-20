import path from 'node:path';
import type { Command } from 'commander';
import { checkGraph, ruleIds } from '../check/check.js';
import type { CheckReport } from '../check/check.js';
import type { ExceptedFinding, Finding } from '../check/findings.js';
import { toFailure } from '../failure.js';
import { defaultGraphFile, loadGraph } from '../graph.js';
import { manifestFileName, readManifest } from '../manifest.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface CheckOptions extends CommonOptions {
  graph?: string;
}

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
        'Check the graph against the API design rules. Exits non-zero on a blocking finding or when the graph does not compose.',
      )
      .option(
        '--graph <file>',
        `The graph file, in the input format of \`wgc router compose\`. Defaults to \`check.graph\` in ${manifestFileName}, then ${defaultGraphFile}.`,
      )
      .addHelpText(
        'after',
        [
          '',
          `Rules are set under \`check.rules\` in ${manifestFileName} as <rule>: error | warn | off.`,
          'A finding of an `error` rule blocks. Approved exceptions go under `check.exceptions` as',
          '{ rule, coordinate, reason } and are reported apart from the open findings.',
          '',
          'Rules:',
          ...ruleIds().map((id) => `  ${id}`),
        ].join('\n'),
      ),
  ).action(async (options: CheckOptions) => {
    const output = dependencies.context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }
    const policy = manifest.data.check ?? {};

    const unknownRule = Object.keys(policy.rules ?? {}).find((rule) => !ruleIds().includes(rule));
    if (unknownRule !== undefined) {
      return output.fail({
        message: `${manifestFileName} sets a rule that does not exist: ${unknownRule}.`,
        input: `${manifestFileName}: check.rules.${unknownRule}`,
        fix: 'Run `wgc forge check --help` to list the rules.',
      });
    }

    const graphPath =
      options.graph === undefined
        ? path.resolve(workspace, policy.graph ?? defaultGraphFile)
        : path.resolve(dependencies.cwd(), options.graph);
    const subgraphs = await loadGraph(graphPath);
    if (!subgraphs.success) {
      return output.fail(toFailure(subgraphs));
    }

    const report = checkGraph(subgraphs.data, policy);

    if (!report.complete) {
      return output.fail({
        message: output.json
          ? 'The check is incomplete: the graph does not compose.'
          : `${renderReport(report)}\nThe check is incomplete: the graph does not compose.`,
        input: graphPath,
        fix: 'Fix the composition errors, then run the check again.',
        details: report,
      });
    }

    if (report.summary.errors > 0) {
      return output.fail({
        message: output.json ? `The check found ${report.summary.errors} blocking finding(s).` : renderReport(report),
        input: graphPath,
        fix: `Repair each finding, or record an approved exception under \`check.exceptions\` in ${manifestFileName}.`,
        details: report,
      });
    }

    output.result(report, renderReport);
  });
};
