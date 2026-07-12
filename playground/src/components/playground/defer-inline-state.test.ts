import { describe, expect, it } from 'vitest';
import {
  advanceInlineAdvisorGeneration,
  inlineAdvisorIdentity,
  isCurrentInlineAdvisorGeneration,
  manualAdvisorContextIdentity,
} from './defer-inline';

describe('inline advisor identity', () => {
  it('invalidates results when the active tab, query, operation, variables, or headers change', () => {
    const base = {
      tabId: 'tab-a',
      query: 'query Shared { viewer { id } }',
      operationName: 'Shared',
      variables: '{"viewerId":"1"}',
      headers: '{"authorization":"Bearer a"}',
    };
    const tabA = inlineAdvisorIdentity(base);
    const tabB = inlineAdvisorIdentity({
      ...base,
      tabId: 'tab-b',
    });
    const changedQuery = inlineAdvisorIdentity({
      ...base,
      query: 'query Shared { viewer { name } }',
    });
    const changedOperation = inlineAdvisorIdentity({
      ...base,
      query: 'query Shared { viewer { id } } query Other { viewer { name } }',
      operationName: 'Other',
    });
    const changedVariables = inlineAdvisorIdentity({
      ...base,
      variables: '{"viewerId":"2"}',
    });
    const changedHeaders = inlineAdvisorIdentity({
      ...base,
      headers: '{"authorization":"Bearer b"}',
    });
    const initial = { identity: '', generation: 0 };
    const active = advanceInlineAdvisorGeneration(initial, tabA);

    expect(advanceInlineAdvisorGeneration(active, tabA)).toBe(active);
    expect(isCurrentInlineAdvisorGeneration(active, active)).toBe(true);

    for (const identity of [tabB, changedQuery, changedOperation, changedVariables, changedHeaders]) {
      const next = advanceInlineAdvisorGeneration(active, identity);
      expect(next.generation).toBe(active.generation + 1);
      expect(isCurrentInlineAdvisorGeneration(active, next)).toBe(false);
    }

    const onTabB = advanceInlineAdvisorGeneration(active, tabB);
    const backOnTabA = advanceInlineAdvisorGeneration(onTabB, tabA);
    expect(backOnTabA.generation).toBe(active.generation + 2);
    expect(isCurrentInlineAdvisorGeneration(active, backOnTabA)).toBe(false);
  });

  it('keeps manual results across query rewrites but resets for request-context changes', () => {
    const base = {
      tabId: 'tab-a',
      operationName: 'Shared',
      variables: '{"viewerId":"1"}',
      headers: '{"authorization":"Bearer a"}',
    };
    const context = manualAdvisorContextIdentity(base);

    expect(manualAdvisorContextIdentity({ ...base })).toBe(context);
    expect(manualAdvisorContextIdentity({ ...base, operationName: 'Other' })).not.toBe(context);
    expect(manualAdvisorContextIdentity({ ...base, variables: '{"viewerId":"2"}' })).not.toBe(context);
    expect(manualAdvisorContextIdentity({ ...base, headers: '{"authorization":"Bearer b"}' })).not.toBe(context);
    expect(manualAdvisorContextIdentity({ ...base, tabId: 'tab-b' })).not.toBe(context);
  });
});
