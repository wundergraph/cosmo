import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { SchemaCheckRepository } from '../src/core/repositories/SchemaCheckRepository.js';
import { InspectorOperationResult } from '../src/core/services/SchemaUsageTrafficInspector.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Overrides', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to detect overrides', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    const namespacesRes = await client.getNamespaces({});
    const namespace = namespacesRes.namespaces.find((n) => n.name === graphRes.graph?.namespace);

    expect(namespace).toBeDefined();
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);

    const createOverrideRes = await client.createOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      operationName: 'op1',
      changes: [
        {
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
    });
    expect(createOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const schemaCheckRepo = new SchemaCheckRepository(server.db);

    const inspectorResult = new Map<string, InspectorOperationResult[]>();
    inspectorResult.set('1', [
      {
        schemaChangeId: '1',
        hash: 'hash1',
        name: 'op1',
        type: 'query',
        lastSeenAt: new Date(),
        firstSeenAt: new Date(),
        isSafeOverride: false,
      },
      {
        schemaChangeId: '1',
        hash: 'hash2',
        name: 'op2',
        type: 'query',
        lastSeenAt: new Date(),
        firstSeenAt: new Date(),
        isSafeOverride: false,
      },
    ]);

    const overrideCheckResult = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
      changes: [
        {
          id: '1',
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
      inspectorResultsByChangeId: inspectorResult,
      namespaceId: namespace?.id ?? '',
    });

    expect(overrideCheckResult.hasUnsafeClientTraffic).toBe(true);
    expect(overrideCheckResult.result.get('1')?.find((op) => op.hash === 'hash1')?.isSafeOverride).toBe(true);
    expect(overrideCheckResult.result.get('1')?.find((op) => op.hash === 'hash2')?.isSafeOverride).toBe(false);

    const createIgnoreOverrideRes = await client.createOperationIgnoreAllOverride({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash2',
      operationName: 'op2',
    });
    expect(createIgnoreOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const overrideCheckResult2 = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
      changes: [
        {
          id: '1',
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
      inspectorResultsByChangeId: inspectorResult,
      namespaceId: namespace?.id ?? '',
    });

    expect(overrideCheckResult2.hasUnsafeClientTraffic).toBe(false);
    expect(overrideCheckResult2.result.get('1')?.find((op) => op.hash === 'hash1')?.isSafeOverride).toBe(true);
    expect(overrideCheckResult2.result.get('1')?.find((op) => op.hash === 'hash2')?.isSafeOverride).toBe(true);

    const removeOverrideRes = await client.removeOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      changes: [
        {
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
    });
    expect(removeOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const overrideCheckResult3 = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
      changes: [
        {
          id: '1',
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
      inspectorResultsByChangeId: inspectorResult,
      namespaceId: namespace?.id ?? '',
    });

    expect(overrideCheckResult3.hasUnsafeClientTraffic).toBe(true);
    expect(overrideCheckResult3.result.get('1')?.find((op) => op.hash === 'hash1')?.isSafeOverride).toBe(false);
    expect(overrideCheckResult3.result.get('1')?.find((op) => op.hash === 'hash2')?.isSafeOverride).toBe(true);

    await server.close();
  });

  test('Should get correct consolidated view', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    const namespacesRes = await client.getNamespaces({});
    const namespace = namespacesRes.namespaces.find((n) => n.name === graphRes.graph?.namespace);

    expect(namespace).toBeDefined();
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);

    const createOverrideRes = await client.createOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      operationName: 'op1',
      changes: [
        {
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
    });
    expect(createOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const createIgnoreOverrideRes = await client.createOperationIgnoreAllOverride({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash2',
      operationName: 'op2',
    });
    expect(createIgnoreOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const overridesRes = await client.getAllOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes?.graph?.namespace,
    });
    expect(overridesRes.response?.code).toBe(EnumStatusCode.OK);
    expect(overridesRes.overrides.length).toBe(2);

    expect(overridesRes.overrides[0].hash).toBe('hash1');
    expect(overridesRes.overrides[0].changesOverrideCount).toBe(1);
    expect(overridesRes.overrides[0].hasIgnoreAllOverride).toBe(false);

    expect(overridesRes.overrides[1].hash).toBe('hash2');
    expect(overridesRes.overrides[1].changesOverrideCount).toBe(0);
    expect(overridesRes.overrides[1].hasIgnoreAllOverride).toBe(true);

    await server.close();
  });
});
