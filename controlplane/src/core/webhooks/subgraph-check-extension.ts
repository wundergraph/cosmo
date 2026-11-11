import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z } from 'zod';

// Bound total findings across subgraphs before validating individual issues.
export const MAX_CHECK_EXTENSION_FINDINGS = 1000;

export const subgraphCheckExtensionSchema = z
  .object({
    errors: z.array(z.unknown()).max(MAX_CHECK_EXTENSION_FINDINGS).optional(),
    lintIssues: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((response, ctx) => {
    let findings = response.errors?.length ?? 0;
    const subgraphs = Object.values(response.lintIssues ?? {});
    if (subgraphs.length > MAX_CHECK_EXTENSION_FINDINGS) {
      ctx.addIssue({ code: 'custom', message: 'Check extension returned too many subgraphs' });
      return;
    }
    for (const issues of subgraphs) {
      findings += Array.isArray(issues) ? issues.length : 1;
      if (findings > MAX_CHECK_EXTENSION_FINDINGS) {
        ctx.addIssue({ code: 'custom', message: 'Check extension returned too many findings' });
        return;
      }
    }
  })
  .pipe(
    z.object({
      errors: z.array(z.string()).max(MAX_CHECK_EXTENSION_FINDINGS).optional(),
      lintIssues: z
        .record(
          z.string(),
          z
            .array(
              z.object({
                lintRuleType: z.string().trim(),
                severity: z.enum(LintSeverity),
                message: z.string().trim(),
                issueLocation: z.object({
                  line: z.number().int().positive(),
                  column: z.number().int().positive(),
                  endLine: z.number().int().positive().optional(),
                  endColumn: z.number().int().positive().optional(),
                }),
              }),
            )
            .max(MAX_CHECK_EXTENSION_FINDINGS),
        )
        .optional(),
    }),
  );

export type SubgraphCheckExtensionResponse = z.infer<typeof subgraphCheckExtensionSchema>;
