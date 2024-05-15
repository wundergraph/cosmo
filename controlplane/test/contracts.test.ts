import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest, createFederatedGraph, createSubgraph } from './test-util.js';

let dbname = '';

describe('Contracts', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Creates a contract for a federated graph', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const fedGraphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(fedGraphRes.graph?.name).toBe(fedGraphName);

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphRes.graph?.namespace).toBe('default');
    expect(contractGraphRes.subgraphs.length).toBe(1);
    expect(contractGraphRes.subgraphs[0].name).toBe(subgraphName);
    expect(contractGraphRes.graph?.contract?.sourceFederatedGraphId).toBe(fedGraphRes.graph?.id);
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual(['test']);
    expect(contractGraphRes.graph?.labelMatchers).toEqual(fedGraphRes.graph?.labelMatchers);
    expect(contractGraphRes.graph?.routingURL).toBe('http://localhost:8081');
    expect(contractGraphRes.graph?.readme).toBe('test');
    expect(contractGraphRes.graph?.supportsFederation).toEqual(true)
    expect(blobStorage.keys().length).toBe(2);

    await server.close();
  });

  test('Updates tags of a contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual(['test']);

    await client.updateContract({
      name: contractGraphName,
      namespace: 'default',
      excludeTags: ['new'],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual(['new']);

    await server.close();
  });

  test('Contract is deleted on deleting source federated graph', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphRes.graph?.contract).toBeDefined();

    expect(blobStorage.keys().length).toBe(2);

    await client.deleteFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
    });

    const contractGraphDeletedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphDeletedRes.response?.code).toEqual(EnumStatusCode.ERR_NOT_FOUND);

    expect(blobStorage.keys().length).toBe(0);

    await server.close();
  });

  test('Label matcher update on source federated graph propagates to contract graphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphRes.graph?.contract).toBeDefined();

    await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label), joinLabel(label2)]
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(contractGraphUpdatedRes.graph?.labelMatchers).toEqual([joinLabel(label), joinLabel(label2)]);

    await server.close();
  });

  test('Label matcher update should not be possible for contract graphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const res = await client.updateFederatedGraph({
      name: contractGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label), joinLabel(label2)]
    });

    expect(res.response?.code).toEqual(EnumStatusCode.ERR)

    await server.close();
  });

  test('Moving source federated graph moves contract graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const prod = 'prod'

    await client.createNamespace({
      name: prod
    })

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');
    await createSubgraph(client, subgraphName, prod, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const moveRes = await client.moveFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      newNamespace: prod
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.OK)

    const contractResAfterMove = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: prod,
    });
    expect(contractResAfterMove.response?.code).toEqual(EnumStatusCode.OK)

    await server.close();
  });

  test('Moving contract federated graph is not allowed', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const prod = 'prod'

    await client.createNamespace({
      name: prod
    })

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const moveRes = await client.moveFederatedGraph({
      name: contractGraphName,
      namespace: 'default',
      newNamespace: prod
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.ERR)

    await server.close();
  });

  test('Contract graph for a monograph is also a monograph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK)
    expect(getContractRes.graph?.supportsFederation).toEqual(false)
    expect(getContractRes.subgraphs.length).toEqual(1)

    await server.close();
  });

  test('Moving source monograph also moves contract graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');
    const prod = 'prod'

    await client.createNamespace({
      name: prod
    })

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const moveRes = await client.moveMonograph({
      name: monographName,
      namespace: 'default',
      newNamespace: prod
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.OK)

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: prod,
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK)
    expect(getContractRes.subgraphs.length).toEqual(1)

    await server.close();
  });

  test('Contract is deleted on deleting source monograph', async (testContext) => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const publishRes1 = await client.publishMonograph({
      name: monographName,
      namespace: 'default',
      schema: 'type Query { hello: String!, hi: String! @tag(name: "test"), test: String! }'
    });
    expect(publishRes1.response?.code).toEqual(EnumStatusCode.OK)

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    expect(blobStorage.keys().length).toBe(2);

    const deleteRes = await client.deleteMonograph({
      name: monographName,
      namespace: 'default',
    });
    expect(deleteRes.response?.code).toEqual(EnumStatusCode.OK)

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.ERR_NOT_FOUND)

    expect(blobStorage.keys().length).toBe(0);

    await server.close();
  });

  test('Contract is migrated on migrating monograph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      admissionWebhookUrl: 'http://localhost:8085',
      readme: 'test',
    });

    const migrateRes = await client.migrateMonograph({
      name: monographName,
      namespace: 'default',
    });
    expect(migrateRes.response?.code).toEqual(EnumStatusCode.OK)

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: 'default',
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK)
    expect(getContractRes.graph?.supportsFederation).toEqual(true)

    await server.close();
  });

  test('Publishing subgraph recomposes contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createSubgraph(client, subgraphName, 'default', subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse.clientSchema).toEqual(`type Query {
  hello: String!
}`)

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String!, hi: String! }'
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse2.clientSchema).toEqual(`type Query {
  hello: String!
  hi: String!
}`)

    await server.close();
  });

  test('Deleting subgraph recomposes contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createSubgraph(client, subgraph1Name, 'default', subgraph1SchemaSDL, [label], 'http://localhost:8082');
    await createSubgraph(client, subgraph2Name, 'default', subgraph2SchemaSDL, [label], 'http://localhost:8083');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse.clientSchema).toEqual(`type Query {
  hello: String!
  test: String!
}`)

    await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: 'default',
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse2.clientSchema).toEqual(`type Query {
  hello: String!
}`)

    await server.close();
  });

  test('Moving subgraph recomposes contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: 'prod'
    })

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createSubgraph(client, subgraph1Name, 'default', subgraph1SchemaSDL, [label], 'http://localhost:8082');
    await createSubgraph(client, subgraph2Name, 'default', subgraph2SchemaSDL, [label], 'http://localhost:8083');

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse.clientSchema).toEqual(`type Query {
  hello: String!
  test: String!
}`)

    await client.moveSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      newNamespace: 'prod'
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse2.clientSchema).toEqual(`type Query {
  hello: String!
}`)

    await server.close();
  });

  test('Publishing monograph recomposes contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const monographSchema = 'type Query { hello: String!, hi: String! @tag(name: "test"), test: String! }';

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: 'default',
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const publishRes1 = await client.publishMonograph({
      name: monographName,
      namespace: 'default',
      schema: monographSchema
    });
    expect(publishRes1.response?.code).toEqual(EnumStatusCode.OK)

    const res = await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse.clientSchema).toEqual(`type Query {
  hello: String!
  test: String!
}`)

    const publishRes2 = await client.publishMonograph({
      name: monographName,
      namespace: 'default',
      schema: 'type Query { hello: String!, hi: String! @tag(name: "test") }'
    });
    expect(publishRes2.response?.code).toEqual(EnumStatusCode.OK)


    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse2.clientSchema).toEqual(`type Query {
  hello: String!
}`)

    await server.close();
  });

  test('Updating label matchers of source federated graph recomposes contract', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    await client.createNamespace({
      name: 'prod'
    })

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createSubgraph(client, subgraph1Name, 'default', subgraph1SchemaSDL, [label1], 'http://localhost:8082');
    await createSubgraph(client, subgraph2Name, 'default', subgraph2SchemaSDL, [label2], 'http://localhost:8083');

    await createFederatedGraph(client, fedGraphName, 'default', [[joinLabel(label1), joinLabel(label2)].join(",")], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: 'default',
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse.clientSchema).toEqual(`type Query {
  hello: String!
  test: String!
}`)

    const updateRes = await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label1)]
    });
    expect(updateRes.response?.code).toEqual(EnumStatusCode.OK)

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: 'default'
    })
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK)
    expect(sdlResponse2.clientSchema).toEqual(`type Query {
  hello: String!
}`)

    await server.close();
  });
});
