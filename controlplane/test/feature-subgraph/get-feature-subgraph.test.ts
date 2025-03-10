import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
    DEFAULT_SUBGRAPH_URL_ONE,
    DEFAULT_SUBGRAPH_URL_TWO,
    SetupTest,
    createBaseAndFeatureSubgraph,
} from '../test-util.js';

let dbname = '';

describe('Get feature subgraph', (ctx) => {
    beforeAll(async () => {
        dbname = await beforeAllSetup()
    })

    afterAll(async () => {
        await afterAllSetup(dbname);
    });

    test('should return feature subgraph by name', async (testContext) => {
        const { client, server } = await SetupTest({ dbname });

        const subgraphName = genID('subgraph');
        const featureSubgraphName = genID('featureSubgraph');

        const createNamespaceResp = await client.createNamespace({
            name: 'prod',
        });

        expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

        await createBaseAndFeatureSubgraph(
            client,
            subgraphName,
            featureSubgraphName,
            DEFAULT_SUBGRAPH_URL_ONE,
            DEFAULT_SUBGRAPH_URL_TWO,
        );

        // fetching feature subgraph from default namespace
        const featureSubgraphResp = await client.getSubgraphByName({
            name: featureSubgraphName,
            namespace: 'default',
        });

        expect(featureSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
        expect(featureSubgraphResp.graph).toBeDefined();
        expect(featureSubgraphResp.graph?.name).toBe(featureSubgraphName);
        expect(featureSubgraphResp.graph?.baseSubgraphName).toBe(subgraphName);


        await server.close();
    });

    test('should return feature subgraph by id', async (testContext) => {
        const { client, server } = await SetupTest({ dbname });

        const subgraphName = genID('subgraph');
        const featureSubgraphName = genID('featureSubgraph');

        const createNamespaceResp = await client.createNamespace({
            name: 'prod',
        });

        expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

        await createBaseAndFeatureSubgraph(
            client,
            subgraphName,
            featureSubgraphName,
            DEFAULT_SUBGRAPH_URL_ONE,
            DEFAULT_SUBGRAPH_URL_TWO,
        );

        // fetching feature subgraph from default namespace
        const featureSubgraphResp = await client.getSubgraphByName({
            name: featureSubgraphName,
            namespace: 'default',
        });

        expect(featureSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
        expect(featureSubgraphResp.graph).toBeDefined();
        expect(featureSubgraphResp.graph?.id).toBeDefined();
        expect(featureSubgraphResp.graph?.name).toBe(featureSubgraphName);
        expect(featureSubgraphResp.graph?.baseSubgraphName).toBe(subgraphName);


        const getByID = await client.getSubgraphById({
            id: featureSubgraphResp.graph?.id,
        })

        expect(getByID.response?.code).toBe(EnumStatusCode.OK);
        expect(getByID.graph).toBeDefined();
        expect(getByID.graph?.id).toBeDefined();
        expect(getByID.graph?.name).toBe(featureSubgraphName);
        expect(getByID.graph?.baseSubgraphName).toBe(subgraphName);

        await server.close();
    })
})
