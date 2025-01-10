import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { TestContext, afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

const seed = async (testContext: TestContext, chClient?: ClickHouseClient) => {
  const { client, server } = await SetupTest({ dbname, chClient });

  const subgraphName = genID('subgraph1');
  const fedGraphName = genID('fedGraph');
  const label = genUniqueLabel();

  const createSubgraphRes = await client.createFederatedSubgraph({
    name: subgraphName,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8080',
  });

  expect(createSubgraphRes.response?.code).toBe(EnumStatusCode.OK);

  const publishResp = await client.publishFederatedSubgraph({
    name: subgraphName,
    namespace: 'default',
    schema: 'type Query { hello: String! }',
  });

  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  const createFedGraphRes = await client.createFederatedGraph({
    name: fedGraphName,
    namespace: 'default',
    routingUrl: 'http://localhost:8081',
    labelMatchers: [joinLabel(label)],
  });

  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

  const { graph, subgraphs } = await client.getFederatedGraphByName({
    name: fedGraphName,
    namespace: 'default',
  });
  const { versionId } = await client.getFederatedGraphSDLByName({
    name: fedGraphName,
    namespace: 'default',
  });

  expect(graph?.targetId).toBeDefined();
  expect(versionId).toBeDefined();
  expect(subgraphs.length).toBe(1);

  return { client, server, graph, subgraphs, schemaVersionId: versionId };
};

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Discussions', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should create discussion', async (testContext) => {
    const { client, server, graph, schemaVersionId } = await seed(testContext, chClient);

    const discussionRes = await client.createDiscussion({
      contentJson: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test"}]}]}`,
      contentMarkdown: `Test`,
      targetId: graph?.targetId,
      referenceLine: 1,
      schemaVersionId,
    });

    expect(discussionRes.response?.code).toBe(EnumStatusCode.OK);

    const discussionsRes = await client.getAllDiscussions({
      targetId: graph?.targetId,
    });

    expect(discussionsRes.discussions.length).toEqual(1);

    await server.close();
  });

  test('Should update discussion comment', async (testContext) => {
    const { client, server, graph, schemaVersionId } = await seed(testContext, chClient);

    const discussionRes = await client.createDiscussion({
      contentJson: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test"}]}]}`,
      contentMarkdown: `Test`,
      targetId: graph?.targetId,
      referenceLine: 1,
      schemaVersionId,
    });
    expect(discussionRes.response?.code).toBe(EnumStatusCode.OK);

    const discussionsRes = await client.getAllDiscussions({
      targetId: graph?.targetId,
    });
    expect(discussionsRes.discussions.length).toEqual(1);

    const discussion = discussionsRes.discussions[0];

    const updatedContentJSON = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test Update"}]}]}`;
    const updateRes = await client.updateDiscussionComment({
      commentId: discussion.openingComment?.id,
      discussionId: discussion.id,
      contentJson: updatedContentJSON,
      contentMarkdown: `Test Update`,
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const updatedDiscussionRes = await client.getDiscussion({
      discussionId: discussion.id,
    });
    expect(updatedDiscussionRes.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedDiscussionRes.discussion?.openingComment?.contentJson).toEqual(updatedContentJSON);

    await server.close();
  });

  test('Should be able to delete reply and discussion correctly', async (testContext) => {
    const { client, server, graph, schemaVersionId } = await seed(testContext, chClient);

    const discussionRes = await client.createDiscussion({
      contentJson: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test"}]}]}`,
      contentMarkdown: `Test`,
      targetId: graph?.targetId,
      referenceLine: 1,
      schemaVersionId,
    });
    expect(discussionRes.response?.code).toBe(EnumStatusCode.OK);

    const discussionsRes = await client.getAllDiscussions({
      targetId: graph?.targetId,
    });
    expect(discussionsRes.discussions.length).toEqual(1);

    const discussion = discussionsRes.discussions[0];

    const replyRes = await client.replyToDiscussion({
      contentJson: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test Reply"}]}]}`,
      contentMarkdown: `Test Reply`,
      discussionId: discussion.id,
    });
    expect(replyRes.response?.code).toBe(EnumStatusCode.OK);

    const updatedDiscussionRes = await client.getDiscussion({
      discussionId: discussion.id,
    });
    expect(updatedDiscussionRes.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedDiscussionRes.comments.length).toEqual(2);

    // First delete the reply. Since this is not the opening comment, the discussion itself should not be deleted
    const deleteCommentRes = await client.deleteDiscussionComment({
      commentId: updatedDiscussionRes.comments[1].id,
      discussionId: updatedDiscussionRes.discussion?.id,
    });
    expect(deleteCommentRes.response?.code).toBe(EnumStatusCode.OK);

    const discussionAfterFirstDeleteRes = await client.getDiscussion({
      discussionId: discussion.id,
    });
    expect(discussionAfterFirstDeleteRes.response?.code).toBe(EnumStatusCode.OK);
    // Ensure it was only soft deleted
    expect(discussionAfterFirstDeleteRes.comments.length).toEqual(2);
    // Ensure that we do not return the content of soft deleted comments
    expect(discussionAfterFirstDeleteRes.comments[1].contentJson).toEqual('');

    // Now delete the first comment. Since this the opening comment, the discussion itself should be deleted
    expect(discussionAfterFirstDeleteRes.comments[0].id).toEqual(discussion.openingComment?.id);
    const deleteComment2Res = await client.deleteDiscussionComment({
      commentId: updatedDiscussionRes.comments[0].id,
      discussionId: updatedDiscussionRes.discussion?.id,
    });
    expect(deleteComment2Res.response?.code).toBe(EnumStatusCode.OK);

    const discussionAfterSecondDeleteRes = await client.getDiscussion({
      discussionId: discussion.id,
    });
    expect(discussionAfterSecondDeleteRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Should be able to get correct reference schemas', async (testContext) => {
    const { client, server, graph, schemaVersionId, subgraphs } = await seed(testContext, chClient);

    const discussionRes = await client.createDiscussion({
      contentJson: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test"}]}]}`,
      contentMarkdown: `Test`,
      targetId: graph?.targetId,
      referenceLine: 1,
      schemaVersionId,
    });
    expect(discussionRes.response?.code).toBe(EnumStatusCode.OK);

    const discussionsRes = await client.getAllDiscussions({
      targetId: graph?.targetId,
    });
    expect(discussionsRes.discussions.length).toEqual(1);

    const discussion = discussionsRes.discussions[0];

    // At this point the latest schema and the schema where discussion was created should be the same
    const schemasRes = await client.getDiscussionSchemas({
      discussionId: discussion.id,
    });
    expect(schemasRes.response?.code).toBe(EnumStatusCode.OK);
    expect(schemasRes.schemas?.reference).toBeDefined();
    expect(schemasRes.schemas?.reference).toEqual(schemasRes?.schemas?.latest);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphs[0].name,
      namespace: 'default',
      schema: 'type Query { hello: String!, bye: String! }',
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // At this point the latest schema and the schema where discussion was created should be different
    const schemasResAfterUpdate = await client.getDiscussionSchemas({
      discussionId: discussion.id,
    });
    expect(schemasResAfterUpdate.response?.code).toBe(EnumStatusCode.OK);
    expect(schemasResAfterUpdate.schemas?.reference).toBeDefined();
    expect(schemasResAfterUpdate.schemas?.reference).not.toEqual(schemasResAfterUpdate?.schemas?.latest);

    await server.close();
  });
});
