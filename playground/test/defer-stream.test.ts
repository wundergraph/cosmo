import { describe, expect, test } from 'vitest';
import { DeferTimeline, readDeferStream } from '../src/lib/defer-stream';

const ROUTER_V02_BODY =
  '--graphql\r\nContent-Type: application/json\r\n\r\n' +
  '{"data":{"pricing":450},"pending":[{"id":"1","path":[],"label":"reviews"}],"hasNext":true}' +
  '\r\n--graphql\r\nContent-Type: application/json\r\n\r\n' +
  '{"incremental":[{"data":{"reviews":[{"text":"Solid frame"},{"text":"Wobbles at full height"}]},"id":"1"}],"completed":[{"id":"1"}],"hasNext":false}' +
  '\r\n--graphql--';

const responseOf = (text: string, size: number) => {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'multipart/mixed; boundary="graphql"; incrementalSpec=v0.2' },
  });
};

const collect = async (parts: AsyncIterable<unknown[]>) => {
  const all: unknown[] = [];
  for await (const chunk of parts) {
    all.push(...chunk);
  }
  return all;
};

describe('readDeferStream', () => {
  for (const size of [1, 7, 4096]) {
    test(`yields path-based parts from the v0.2 body (chunks of ${size} bytes)`, async () => {
      const parts = await collect(readDeferStream(responseOf(ROUTER_V02_BODY, size)));

      expect(parts).toEqual([
        { data: { pricing: 450 }, hasNext: true },
        {
          data: { reviews: [{ text: 'Solid frame' }, { text: 'Wobbles at full height' }] },
          path: [],
          label: 'reviews',
          hasNext: false,
        },
      ]);
    });
  }

  test('yields each part before the next part has started arriving', async () => {
    const firstPart =
      '--graphql\r\nContent-Type: application/json\r\n\r\n' +
      '{"data":{"pricing":450},"pending":[{"id":"1","path":[],"label":"reviews"}],"hasNext":true}\r\n--graphql';
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
    });
    const response = new Response(body, {
      headers: { 'content-type': 'multipart/mixed; boundary="graphql"; incrementalSpec=v0.2' },
    });

    const parts = readDeferStream(response)[Symbol.asyncIterator]();
    source.enqueue(new TextEncoder().encode(firstPart));

    const { value } = await Promise.race([
      parts.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('first part was held back')), 500)),
    ]);

    expect(value).toEqual([{ data: { pricing: 450 }, hasNext: true }]);
    source.close();
    await parts.return(undefined);
  });

  test('reports completion and arrival times for labelled parts only', async () => {
    const timelines: DeferTimeline[] = [];
    await collect(readDeferStream(responseOf(ROUTER_V02_BODY, 4096), (timeline) => timelines.push(timeline)));

    expect(timelines.at(-1)?.state).toBe('complete');
    expect(timelines.at(-1)?.arrived.map((a) => a.label)).toEqual(['reviews']);
  });

  test('rejects when the body stream errors partway through', async () => {
    const bytes = new TextEncoder().encode(
      '--graphql\r\nContent-Type: application/json\r\n\r\n{"data":{"pricing":450},"hasNext":true}\r\n--graphql\r\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.error(new Error('connection reset'));
      },
    });
    const response = new Response(body, {
      headers: { 'content-type': 'multipart/mixed; boundary="graphql"; incrementalSpec=v0.2' },
    });

    await expect(collect(readDeferStream(response))).rejects.toThrow('connection reset');
  });

  test('rejects a part that does not match the v0.2 shape', async () => {
    const body =
      '--graphql\r\nContent-Type: application/json\r\n\r\n' +
      '{"incremental":"not-an-array","hasNext":false}\r\n--graphql--';

    await expect(collect(readDeferStream(responseOf(body, 4096)))).rejects.toThrow();
  });

  test('passes the initial part, with its extensions, to onInitialPart', async () => {
    const initial: unknown[] = [];
    const body =
      '--graphql\r\nContent-Type: application/json\r\n\r\n' +
      '{"data":{"pricing":450},"extensions":{"trace":{"version":"1"}},"pending":[{"id":"1","path":[],"label":"reviews"}],"hasNext":true}' +
      '\r\n--graphql\r\nContent-Type: application/json\r\n\r\n' +
      '{"incremental":[{"data":{"reviews":[]},"id":"1"}],"completed":[{"id":"1"}],"hasNext":false}' +
      '\r\n--graphql--';

    await collect(readDeferStream(responseOf(body, 4096), undefined, (part) => initial.push(part)));

    expect(initial).toEqual([{ data: { pricing: 450 }, extensions: { trace: { version: '1' } }, hasNext: true }]);
  });

  test('reports once per change rather than once per chunk', async () => {
    const timelines: DeferTimeline[] = [];
    await collect(readDeferStream(responseOf(ROUTER_V02_BODY, 1), (timeline) => timelines.push(timeline)));

    expect(timelines.map((t) => t.state)).toEqual(['streaming', 'complete']);
  });
});
