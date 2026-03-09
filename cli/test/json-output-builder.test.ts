import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { JsonOutputBuilder } from '../src/json-output-builder.js';
import type { JsonOutputDescriptor } from '../src/json-output-builder.js';

describe('JsonOutputBuilder', () => {
  describe('constructor / build', () => {
    it('initialises with error status and given code and rowLimit', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.ERR, 50);
      expect(b.build()).toMatchObject<Partial<JsonOutputDescriptor>>({
        status: 'error',
        code: EnumStatusCode.ERR,
        rowLimit: 50,
      });
    });
  });

  describe('setStatus', () => {
    it('sets status to success when true', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setStatus(true);
      expect(b.build().status).toBe('success');
    });

    it('sets status to error when false', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setStatus(false);
      expect(b.build().status).toBe('error');
    });
  });

  describe('setCode', () => {
    it('updates code', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.ERR, 10);
      b.setCode(EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA);
      expect(b.build().code).toBe(EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA);
    });
  });

  describe('setUrl / setMessage / setDetails', () => {
    it('sets url, message, and details', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setUrl('https://example.com').setMessage('hello').setDetails('some detail');
      const result = b.build();
      expect(result.url).toBe('https://example.com');
      expect(result.message).toBe('hello');
      expect(result.details).toBe('some detail');
    });

    it('setDetails with undefined clears details', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setDetails(undefined);
      expect(b.build().details).toBeUndefined();
    });
  });

  describe('proposals', () => {
    it('setProposals overwrites existing proposals', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setProposals('first').setProposals('second');
      expect(b.build().proposals).toEqual({ message: 'second' });
    });

    it('initProposals does not overwrite if already set', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setProposals('original').initProposals('ignored');
      expect(b.build().proposals).toEqual({ message: 'original' });
    });

    it('initProposals sets value when not set', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.initProposals('new');
      expect(b.build().proposals).toEqual({ message: 'new' });
    });
  });

  describe('traffic', () => {
    it('setTraffic replaces traffic', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setTraffic('ok');
      expect(b.build().traffic).toEqual({ message: 'ok' });
    });

    it('markTrafficLinkedFailed uses fallback when no prior message', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.markTrafficLinkedFailed('fallback');
      expect(b.build().traffic).toMatchObject({
        message: 'fallback',
      });
    });

    it('markTrafficLinkedFailed preserves prior message', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setTraffic('prior').markTrafficLinkedFailed('fallback');
      expect(b.build().traffic?.message).toBe('prior');
    });
  });

  describe('schema changes', () => {
    const change = {
      changeType: 'FIELD_REMOVED',
      message: 'field removed',
      path: 'Query.foo',
      isBreaking: true,
    } as any;
    const nonChange = {
      changeType: 'FIELD_ADDED',
      message: 'field added',
      path: 'Query.bar',
      isBreaking: false,
    } as any;

    it('addBreakingChanges accumulates changes', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addBreakingChanges([change]).addBreakingChanges([change]);
      expect(b.build().changes?.breaking).toHaveLength(2);
      expect(b.build().changes?.nonBreaking).toHaveLength(0);
    });

    it('addNonBreakingChanges accumulates changes', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addNonBreakingChanges([nonChange]).addNonBreakingChanges([nonChange]);
      expect(b.build().changes?.nonBreaking).toHaveLength(2);
      expect(b.build().changes?.breaking).toHaveLength(0);
    });

    it('mixing breaking and non-breaking preserves both', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addBreakingChanges([change]).addNonBreakingChanges([nonChange]);
      expect(b.build().changes?.breaking).toHaveLength(1);
      expect(b.build().changes?.nonBreaking).toHaveLength(1);
    });
  });

  describe('composition', () => {
    const err = { message: 'compose error', federatedGraphName: 'g', namespace: 'ns' } as any;
    const warn = { message: 'compose warning', federatedGraphName: 'g', namespace: 'ns' } as any;

    it('addCompositionErrors accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addCompositionErrors([err]).addCompositionErrors([err]);
      const comp = b.build().composition!;
      expect(comp.errors).toHaveLength(2);
      expect(comp.warnings).toHaveLength(0);
    });

    it('addCompositionWarnings accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addCompositionWarnings([warn]).addCompositionWarnings([warn]);
      const comp = b.build().composition!;
      expect(comp.warnings).toHaveLength(2);
      expect(comp.errors).toHaveLength(0);
    });
  });

  describe('lint', () => {
    const lintErr = { message: 'lint error', lintRuleType: 'RULE_A', issueLocation: { line: 1, column: 1 } } as any;
    const lintWarn = { message: 'lint warn', lintRuleType: 'RULE_B', issueLocation: { line: 2, column: 1 } } as any;

    it('addLintErrors accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addLintErrors([lintErr]).addLintErrors([lintErr]);
      const lint = b.build().lint!;
      expect(lint.errors).toHaveLength(2);
    });

    it('addLintWarnings accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addLintWarnings([lintWarn]);
      const lint = b.build().lint!;
      expect(lint.warnings).toHaveLength(1);
    });
  });

  describe('graphPrune', () => {
    const pruneErr = {
      message: 'prune error',
      graphPruningRuleType: 'RULE',
      federatedGraphName: 'g',
      fieldPath: 'f',
      issueLocation: { line: 1 },
    } as any;
    const pruneWarn = {
      message: 'prune warn',
      graphPruningRuleType: 'RULE',
      federatedGraphName: 'g',
      fieldPath: 'f',
    } as any;

    it('addGraphPruneErrors accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addGraphPruneErrors([pruneErr]).addGraphPruneErrors([pruneErr]);
      const gp = b.build().graphPrune!;
      expect(gp.errors).toHaveLength(2);
      expect(gp.warnings).toHaveLength(0);
    });

    it('addGraphPruneWarnings accumulates', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.addGraphPruneWarnings([pruneWarn]);
      const gp = b.build().graphPrune!;
      expect(gp.warnings).toHaveLength(1);
    });

    it('markGraphPruneLinkedFailed initializes graphPrune', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.markGraphPruneLinkedFailed();
      const gp = b.build().graphPrune!;
      expect(gp).toBeDefined();
      expect(gp.errors).toHaveLength(0);
      expect(gp.warnings).toHaveLength(0);
    });
  });

  describe('extensions / exceededRowLimit / operationUsageStats', () => {
    it('setExtensionError sets message', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setExtensionError('bad extension');
      expect(b.build().extensions).toEqual({ message: 'bad extension' });
    });

    it('setExceededRowLimit stores the flag', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setExceededRowLimit(true);
      expect(b.build().exceededRowLimit).toBe(true);
    });

    it('setOperationUsageStats does not overwrite if already set', () => {
      const stats1 = { totalOperations: 5 } as any;
      const stats2 = { totalOperations: 99 } as any;
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setOperationUsageStats(stats1).setOperationUsageStats(stats2);
      expect(b.build().operationUsageStats?.totalOperations).toBe(5);
    });
  });

  describe('write', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs to console when no outFile', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      b.setStatus(true);
      await b.write();
      expect(spy).toHaveBeenCalledWith(b.build());
    });

    it('writes JSON to file when outFile provided', async () => {
      const outFile = join(tmpdir(), `json-output-builder-test-${Date.now()}.json`);
      try {
        const b = new JsonOutputBuilder(EnumStatusCode.OK, 10, outFile);
        b.setStatus(true).setMessage('done');
        await b.write();
        const written = JSON.parse(readFileSync(outFile, 'utf8'));
        expect(written).toMatchObject({ status: 'success', message: 'done' });
      } finally {
        rmSync(outFile, { force: true });
      }
    });
  });

  describe('method chaining', () => {
    it('all setters return this for fluent chaining', () => {
      const b = new JsonOutputBuilder(EnumStatusCode.OK, 10);
      const result = b
        .setUrl('https://x.com')
        .setCode(EnumStatusCode.OK)
        .setStatus(true)
        .setMessage('msg')
        .setDetails('det')
        .setExceededRowLimit(false);
      expect(result).toBe(b);
    });
  });
});
