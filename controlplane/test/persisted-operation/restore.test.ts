import { pino } from 'pino';
import { expect, test, vi } from 'vitest';
import { prepareOperationBlobRestore } from '../../src/core/bufservices/persisted-operation/restore.js';
import { InMemoryBlobStorage } from '../test-util.js';

test('recovery waits for all writes despite failures and preserves legacy file contents', async () => {
  const storage = new InMemoryBlobStorage();
  const logger = pino({ level: 'silent' });
  const logError = vi.spyOn(logger, 'error');
  const legacyBody = '{ "version": 1, "body": "query { hello }" }';
  await storage.putObject({ key: 'legacy', body: Buffer.from(legacyBody), contentType: 'application/json' });
  const restore = await prepareOperationBlobRestore(
    storage,
    [
      { filePath: 'failed', contents: 'query { hello }' },
      { filePath: 'delayed', contents: 'query { __typename }' },
      { filePath: 'legacy', contents: '' },
    ],
    logger,
  );
  await storage.deleteObject({ key: 'legacy' });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const put = storage.putObject.bind(storage);
  vi.spyOn(storage, 'putObject').mockImplementation(async (input) => {
    if (input.key === 'failed') {
      throw new Error('storage unavailable');
    }
    if (input.key === 'delayed') {
      started.resolve();
      await release.promise;
    }
    return put(input);
  });
  let finished = false;
  const recovering = restore().then(() => {
    finished = true;
  });
  try {
    await started.promise;
    expect(finished).toBe(false);
  } finally {
    release.resolve();
    await recovering;
  }
  expect(logError).toHaveBeenCalledWith(expect.objectContaining({ key: 'failed' }), expect.any(String));
  expect(await new Response((await storage.getObject({ key: 'legacy' })).stream).text()).toBe(legacyBody);
  expect(JSON.parse(await new Response((await storage.getObject({ key: 'delayed' })).stream).text())).toEqual({
    version: 1,
    body: 'query { __typename }',
  });
});
