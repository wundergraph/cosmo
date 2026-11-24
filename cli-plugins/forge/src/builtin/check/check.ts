import { federateSubgraphs, ROUTER_COMPATIBILITY_VERSION_ONE } from '@wundergraph/composition';
import type { CheckPolicy } from '@wundergraph/wgc-plugin-sdk/config';
import type { LoadedSubgraph } from './subgraphs.js';
import type { ExceptedFinding, Finding, Severity } from './findings.js';
import { lintRules } from './lint-rules.js';
import { checkPagination, paginationRule } from './pagination.js';

type Level = Severity | 'off';

/** Cosmo's lint rules warn until a team makes them blocking. The pagination convention is a team's choice. */
const defaultLevels = new Map<string, Level>([
  ...lintRules.map((rule): [string, Level] => [rule.id, rule.defaultSeverity]),
  [paginationRule, 'off'],
]);

export const ruleIds = (): string[] => [...defaultLevels.keys()];

export interface CheckReport {
  /** False when the graph did not compose, so the rules that read the composed schema did not run. */
  complete: boolean;
  compositionErrors: string[];
  findings: Finding[];
  exceptions: ExceptedFinding[];
  summary: { errors: number; warnings: number; exceptions: number; subgraphs: number };
}

const levelOf = (policy: CheckPolicy, rule: string): Level => policy.rules?.[rule] ?? defaultLevels.get(rule) ?? 'off';

const lintFindings = (subgraphs: LoadedSubgraph[], policy: CheckPolicy): Finding[] => {
  const findings: Finding[] = [];

  for (const subgraph of subgraphs) {
    for (const rule of lintRules) {
      const severity = levelOf(policy, rule.id);
      if (severity === 'off') {
        continue;
      }

      for (const violation of rule.check(subgraph.document)) {
        const start = violation.node.loc?.startToken;
        findings.push({
          rule: rule.id,
          severity,
          coordinate: violation.coordinate,
          message: violation.message,
          ...(start === undefined ? {} : { location: { file: subgraph.file, line: start.line, column: start.column } }),
        });
      }
    }
  }

  return findings;
};

const compose = (subgraphs: LoadedSubgraph[]) =>
  federateSubgraphs({
    subgraphs: subgraphs.map((subgraph) => ({
      name: subgraph.name,
      url: subgraph.routingUrl,
      definitions: subgraph.document,
    })),
    version: ROUTER_COMPATIBILITY_VERSION_ONE,
  });

/** Evaluates every subgraph schema, and the composed consumer-visible schema, against the team's rules. */
export const checkGraph = (subgraphs: LoadedSubgraph[], policy: CheckPolicy): CheckReport => {
  const all = lintFindings(subgraphs, policy);

  const composed = compose(subgraphs);
  const compositionErrors = composed.success ? [] : composed.errors.map((error) => error.message);

  const paginationLevel = levelOf(policy, paginationRule);
  if (composed.success && paginationLevel !== 'off') {
    for (const finding of checkPagination(composed.federatedGraphClientSchema, subgraphs)) {
      all.push({ ...finding, severity: paginationLevel });
    }
  }

  const findings: Finding[] = [];
  const exceptions: ExceptedFinding[] = [];
  for (const finding of all) {
    const exception = policy.exceptions?.find(
      (candidate) => candidate.rule === finding.rule && candidate.coordinate === finding.coordinate,
    );
    if (exception === undefined) {
      findings.push(finding);
    } else {
      exceptions.push({ ...finding, reason: exception.reason });
    }
  }

  return {
    complete: composed.success,
    compositionErrors,
    findings,
    exceptions,
    summary: {
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warn').length,
      exceptions: exceptions.length,
      subgraphs: subgraphs.length,
    },
  };
};
