import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, test, vi } from "vitest";
import { PlaygroundUrlState, TabState } from "../components/playground/types";
import { PLAYGROUND_STATE_QUERY_PARAM } from "../lib/constants";
import { decompressState, extractStateFromUrl } from "../lib/playground-url-state-decoding";
import { buildStateToShare } from "../lib/playground-url-state-encoding";

describe("buildStateToShare", () => {
  const tab: TabState = {
    id: "tab-1",
    hash: "hash-1",
    title: "Tab 1",
    operationName: "MyEmployees",
    response: "response",
    query: "query MyEmployees { hello }",
    variables: '{ "x": 1 }',
    headers: '{ "X-Test": "1" }',
  };

  test("filters by only operation by default", () => {
    const selected = {
      operation: true,
      variables: false,
      headers: false,
    };

    const result = buildStateToShare(selected, tab);

    expect(result).toEqual({ operation: "query MyEmployees { hello }" });
    expect(result).not.toHaveProperty("headers");
    expect(result).not.toHaveProperty("variables");
  });

  test("includes all selected fields", () => {
    const selected = {
      operation: true,
      variables: true,
      headers: true,
    };

    const result = buildStateToShare(selected, tab);

    expect(result.operation).toBe("query MyEmployees { hello }");
    expect(result.variables).toBe('{ "x": 1 }');
    expect(result.headers).toEqual('{ "X-Test": "1" }');
  });

  test("excludes unselected optional fields", () => {
    const selected = {
      operation: true,
      variables: true,
      headers: false,
    };

    const result = buildStateToShare(selected, tab);

    expect(result.operation).toBe("query MyEmployees { hello }");
    expect(result.variables).toBe('{ "x": 1 }');
    expect(result).not.toHaveProperty("headers");
  });
});

describe("createCompressedStateUrl", () => {
  test("returns valid URL with compressed query param", async () => {
    const { createCompressedStateUrl } = await import("../lib/playground-url-state-encoding");

    const state = { operation: "query { test }" };
    const BASE_URL = "https://my.studio.dev";
    const compressedUrl = createCompressedStateUrl(state, BASE_URL);

    expect(compressedUrl).toContain(`${BASE_URL}/?`);
    expect(compressedUrl).toContain(`${PLAYGROUND_STATE_QUERY_PARAM}=`);

    const url = new URL(compressedUrl);
    const value = url.searchParams.get(PLAYGROUND_STATE_QUERY_PARAM);
    // sanity check: something's encoded
    expect(value?.length).toBeGreaterThan(10);
  });

  test("throws error if compression fails", async () => {
     // ensure a fresh module state
    vi.resetModules();

    // Mock lz-string's compression to simulate a failure
    // Note: doMock must be followed by re-import
    vi.doMock("lz-string", async () => {
      const actual = await vi.importActual<typeof import("lz-string")>("lz-string");
      return {
        ...actual,
        compressToEncodedURIComponent: () => "",
      };
    });

    // Re-import the module after mocking to ensure mock is applied
    const { createCompressedStateUrl } = await import("../lib/playground-url-state-encoding");

    expect(() => {
      createCompressedStateUrl({ operation: "query { fail }" });
    }).toThrow("Failed to compress playground state");
  });
});

describe("decompressState", () => {
  test("successfully decompresses valid state", () => {
    const originalState: PlaygroundUrlState = {
      operation: "query { test }",
      variables: '{ "foo": "bar" }',
    };

    const compressed = compressToEncodedURIComponent(JSON.stringify(originalState));
    const result = decompressState(compressed);

    expect(result).toEqual(originalState);
  });

  test("throws error if decompressFromEncodedURIComponent fails", async () => {
    // ensure a fresh module state
    vi.resetModules();
  
    vi.doMock("lz-string", async () => {
      const actual = await vi.importActual<typeof import("lz-string")>("lz-string");
      return {
        ...actual,
        decompressFromEncodedURIComponent: () => null, // simulate failure
      };
    });
  
    // re-import after mock is applied
    const { decompressState } = await import("../lib/playground-url-state-decoding");
  
    expect(() => {
      decompressState("invalid-compressed-string");
    }).toThrow("Failed to decompress playground state");
  });

  test("throws error if schema is invalid", async () => {
    // ensure a fresh module state
    vi.resetModules();
  
    // missing required "operation" field
    const badState = { foo: "bar" };
    const compressed = compressToEncodedURIComponent(JSON.stringify(badState));
  
    // re-import decompressState after module reset
    // Note: lz-string doesn't need to be mocked here
    const { decompressState } = await import("../lib/playground-url-state-decoding");
  
    expect(() => {
      decompressState(compressed);
    }).toThrow("Failed to decompress playground state");
  });
});

describe("extractStateFromUrl", () => {
  test("extracts state properly if URL has valid param", () => {
    const state = { operation: "query { test }" };
    const compressed = compressToEncodedURIComponent(JSON.stringify(state));
    const mockUrl = `https://mock.com/?${PLAYGROUND_STATE_QUERY_PARAM}=${compressed}`;

    // Stub the window.location object. It is scoped locally (i.e. automatically cleaned up) in the test
    vi.stubGlobal("location", new URL(mockUrl));

    const result = extractStateFromUrl();
    expect(result).toEqual(state);
  });

  test("returns null if param is missing", () => {
    const mockUrl = `https://mock.com/`;

    // Stub the window.location object. It is scoped locally (i.e. automatically cleaned up) in the test
    vi.stubGlobal("location", new URL(mockUrl));

    const result = extractStateFromUrl();
    expect(result).toBeNull();
  });
});