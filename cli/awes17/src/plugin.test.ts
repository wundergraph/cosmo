import { describe, test, expect } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import type { Subprocess } from "bun";

// Generated gRPC types
import { Awes17ServiceClient } from '../generated/service_grpc_pb.js';
import { QueryHelloRequest, QueryHelloResponse } from "../generated/service_pb.js";

function queryHello(client: Awes17ServiceClient, name: string): Promise<QueryHelloResponse> {
  return new Promise((resolve, reject) => {
    const req = new QueryHelloRequest();
    req.setName(name);
    client.queryHello(req, (err, resp) => {
      if (err) {
        reject(err);
        return;
      }
      if (!resp) {
        reject(new Error("empty response"));
        return;
      }
      resolve(resp);
    });
  });
}

describe("Awes17ServiceService.queryHello", () => {
  test("returns greeting with sequential world IDs", async () => {
    const [subprocess, address] = await startPluginProcess();
    const client = createClient(address);
    try {
      const cases = [
        { name: "Alice", wantId: "world-1", wantName: "Hello from Awes17Service plugin! Alice" },
        { name: "", wantId: "world-2", wantName: "Hello from Awes17Service plugin! " },
        { name: "John & Jane", wantId: "world-3", wantName: "Hello from Awes17Service plugin! John & Jane" },
      ];

      for (const c of cases) {
        const resp = await queryHello(client, c.name);
        const world = resp.getHello();
        expect(world).toBeTruthy();
        expect(world!.getId()).toBe(c.wantId);
        expect(world!.getName()).toBe(c.wantName);
      }
    } finally {
      client.close();
      subprocess.kill();
    }
  });

  test("IDs increment across multiple requests in a fresh process", async () => {
    const [subprocess, address] = await startPluginProcess();
    const client = createClient(address);
    try {
      const first = await queryHello(client, "First");
      expect(first.getHello()!.getId()).toBe("world-1");

      const second = await queryHello(client, "Second");
      expect(second.getHello()!.getId()).toBe("world-2");

      const third = await queryHello(client, "Third");
      expect(third.getHello()!.getId()).toBe("world-3");
    } finally {
      client.close();
      subprocess.kill();
    }
  });
});


async function startPluginProcess(): Promise<[Subprocess, string]> {
  const proc = Bun.spawn(["bun", "run", "src/plugin.ts"], {
    stdout: "pipe",
    stderr: "inherit",
  });

  // Read the first line from stdout and parse the address
  if (!proc.stdout) {
    throw new Error("plugin stdout not available");
  }
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  reader.releaseLock();

  const text = decoder.decode(value ?? new Uint8Array());
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const parts = firstLine.split("|");
  const address = parts[3];

  return [proc, address];
}

function createClient(address: string): Awes17ServiceClient {
  const target = 'unix://' + address;
  return new Awes17ServiceClient(target, grpc.credentials.createInsecure());
}