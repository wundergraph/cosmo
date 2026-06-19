// @defer federation demo — TypeScript HTTP test suite.
//
// Drives the locally-running cosmo router (ROUTER_URL, default
// http://localhost:3002/graphql) across the full normal-mode (N-01..N-14)
// and defer-mode (DT-01..DT-19) matrices from DESIGN.md §5, asserting the
// EXACT expected results from FIXTURES.md.
//
// Per-test policy:
//   - Normal cases (N-*): assert the ENTIRE response object with toEqual.
//   - Defer cases (DT-*): assert the exact initial payload (data + hasNext +
//     full pending[]), assert each incremental frame's full body, and ALWAYS
//     assert the round-trip invariant reconstruct(frames) === normal result.
//   - Parallel/non-deterministic ordering (DT-07/12/13/15) collects frames
//     into a map keyed by completed id / subPath before asserting, and asserts
//     exactly ONE frame has hasNext:false.
//
// // TODO-OBSERVED markers flag sub-assertions whose exact value (pending id
// numbering, precise subPath shape) cannot be known until the router is
// observed; these must be tightened after the first real run. Round-trip and
// structural assertions stay hard.

import { describe, it, expect } from "vitest";
import {
  postJSON,
  postDefer,
  reconstruct,
  type DeferFrame,
} from "./helpers/multipart.js";

// Generous timeout: slow defer targets sleep ~150ms.
const TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Expected normal-mode results (FIXTURES.md §11). Full objects, inline.
// ---------------------------------------------------------------------------

const N01 = {
  data: {
    article: {
      id: "a1",
      title: "Hello World",
      author: { id: "u1", displayName: "Alice Author" },
    },
  },
};
const N02 = { data: { articleBySlug: { id: "a1", title: "Hello World" } } };
const N03 = {
  data: {
    article: {
      reviews: [
        { id: "r1", rating: 5, readingTimeAdjusted: 7 },
        { id: "r2", rating: 3, readingTimeAdjusted: 5 },
      ],
    },
  },
};
const N04 = {
  data: { organization: { subscription: { status: "active", seatUtilization: 0.75 } } },
};
const N05 = {
  data: { featuredArticle: { title: "Hello World", author: { displayName: "Alice Author" } } },
};
const N06 = {
  data: { article: { heroImageUrl: "https://cdn.example.com/hero/a1.jpg" } },
};
const N07 = {
  data: {
    article: { stats: { views: 1500, shares: 42 } },
    podcast: { stats: { views: 500 } },
  },
};
const N08 = {
  data: {
    search: [
      { __typename: "Article", id: "a1", title: "Hello World" },
      { __typename: "Article", id: "a2", title: "World News" },
      { __typename: "Podcast", id: "p1", durationSeconds: 1800 },
    ],
  },
};
const N09 = {
  data: {
    article: {
      relatedContent: [
        { __typename: "Article", title: "World News" },
        { __typename: "Podcast", title: "The Hello Podcast" },
      ],
    },
  },
};
const N10 = {
  data: {
    asset: {
      __typename: "VideoAsset",
      id: "v1",
      url: "https://cdn.example.com/vid/v1.mp4",
      transcodeProgress: 0.75,
    },
  },
};
const N13 = {
  data: {
    organization: {
      subscription: { id: "s1", orgId: "o1", planId: "pro", status: "active" },
      invoices: [
        { id: "inv1", amountCents: 9900, paid: true },
        { id: "inv2", amountCents: 4900, paid: false },
      ],
    },
  },
};
const N14 = {
  data: {
    user: {
      displayName: "Alice Author",
      reviews: [{ rating: 3 }, { rating: 4 }, { rating: 2 }],
      recommendedArticles: [{ title: "World News" }],
    },
  },
};

// ---------------------------------------------------------------------------
// Defer round-trip targets (FIXTURES.md §12). Full objects, inline.
// ---------------------------------------------------------------------------

const RT_DT01 = {
  data: {
    article: {
      id: "a1",
      title: "Hello World",
      reviews: [
        { id: "r1", rating: 5 },
        { id: "r2", rating: 3 },
      ],
    },
  },
};
const RT_DT03 = { data: { article: { id: "a1", title: "Hello World" } } };
const RT_DT07 = {
  data: {
    article: {
      id: "a1",
      reviews: [{ id: "r1" }, { id: "r2" }],
      relatedContent: [{ __typename: "Article" }, { __typename: "Podcast" }],
    },
  },
};
const RT_DT08 = {
  data: {
    user: {
      id: "u1",
      recommendedArticles: [{ id: "a2", reviews: [{ rating: 4 }] }],
    },
  },
};
const RT_DT09 = {
  data: {
    user: {
      displayName: "Alice Author",
      reviews: [
        { id: "r2", rating: 3 },
        { id: "r3", rating: 4 },
        { id: "r5", rating: 2 },
      ],
    },
  },
};
const RT_DT10 = {
  data: {
    article: {
      id: "a1",
      wordCount: 400,
      reviews: [{ readingTimeAdjusted: 7 }, { readingTimeAdjusted: 5 }],
    },
  },
};
const RT_DT11 = {
  data: { featuredArticle: { id: "a1", author: { displayName: "Alice Author" } } },
};
const RT_DT12 = {
  data: {
    search: [
      { __typename: "Article", title: "Hello World", wordCount: 400 },
      { __typename: "Article", title: "World News", wordCount: 1000 },
      { __typename: "Podcast", durationSeconds: 1800 },
    ],
  },
};
const RT_DT13 = {
  data: {
    article: {
      relatedContent: [
        { __typename: "Article", title: "World News", publishedAt: "2024-02-20T00:00:00Z" },
        { __typename: "Podcast", title: "The Hello Podcast", publishedAt: "2024-03-10T00:00:00Z" },
      ],
    },
  },
};
const RT_DT14 = {
  data: {
    article: { id: "a1", stats: { views: 1500, shares: 42, avgReadSeconds: 95.5 } },
  },
};
const RT_DT15 = {
  data: {
    articles: [
      { id: "a1", reviews: [{ id: "r1" }, { id: "r2" }] },
      { id: "a2", reviews: [{ id: "r3" }] },
    ],
  },
};
const RT_DT16 = {
  data: { asset: { __typename: "VideoAsset", id: "v1", transcodeProgress: 0.75 } },
};
const RT_DT17 = {
  data: {
    organization: { id: "o1", subscription: { status: "active", seatUtilization: 0.75 } },
  },
};
const RT_DT18 = {
  data: { article: { id: "a1", author: { username: "alice" } } },
};
const RT_DT19 = {
  data: {
    article: {
      id: "a1",
      title: "Hello World",
      reviews: [{ id: "r1" }, { id: "r2" }],
      relatedContent: [{ __typename: "Article" }, { __typename: "Podcast" }],
      stats: { views: 1500, shares: 42, avgReadSeconds: 95.5 },
    },
  },
};

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

// Find the single frame whose hasNext is false; assert exactly one exists.
function expectExactlyOneFinal(frames: DeferFrame[]): DeferFrame {
  const finals = frames.filter((f) => f.hasNext === false);
  expect(finals.length).toBe(1);
  return finals[0];
}

// Assert no frame other than the final declares hasNext:false; every
// non-final frame is hasNext:true.
function expectHasNextProgression(frames: DeferFrame[]): void {
  // initial frame is frames[0]; it must be hasNext:true when there are >1.
  for (let i = 0; i < frames.length - 1; i++) {
    expect(frames[i].hasNext).toBe(true);
  }
  expect(frames[frames.length - 1].hasNext).toBe(false);
}

// Collect every incremental item across all frames into a map keyed by id.
function incrementalById(frames: DeferFrame[]): Map<string, DeferFrame["incremental"] extends (infer T)[] ? T : never> {
  const m = new Map<string, any>();
  for (const f of frames) {
    for (const item of f.incremental ?? []) {
      // For non-deterministic ordering we key by id; list-defer cases that
      // reuse one id per element key by id+subPath instead (see DT-15).
      const key = item.subPath ? `${item.id}@${JSON.stringify(item.subPath)}` : item.id;
      m.set(key, item);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Normal-mode matrix (N-01..N-14)
// ---------------------------------------------------------------------------

describe("normal mode (N-01..N-14)", () => {
  it("N-01 single @key + cross-subgraph author", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ article(id:"a1"){ id title author{ id displayName } } }`);
    expect(r).toEqual(N01);
  });

  it("N-02 composite key lookup", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ articleBySlug(slug:"hello", locale:"en"){ id title } }`);
    expect(r).toEqual(N02);
  });

  it("N-03 @requires (reviews)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ article(id:"a1"){ reviews{ id rating readingTimeAdjusted } } }`);
    expect(r).toEqual(N03);
  });

  it("N-04 @requires (billing)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ organization(id:"o1"){ subscription{ status seatUtilization } } }`);
    expect(r).toEqual(N04);
  });

  it("N-05 @provides", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ featuredArticle{ title author{ displayName } } }`);
    expect(r).toEqual(N05);
  });

  it("N-06 @override", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ article(id:"a1"){ heroImageUrl } }`);
    expect(r).toEqual(N06);
  });

  it("N-07 @interfaceObject stats", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ article(id:"a1"){ stats{ views shares } } podcast(id:"p1"){ stats{ views } } }`);
    expect(r).toEqual(N07);
  });

  it("N-08 union across subgraphs", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(
      `{ search(term:"x"){ __typename ... on Article{ id title } ... on Podcast{ id durationSeconds } } }`,
    );
    expect(r).toEqual(N08);
  });

  it("N-09 interface Publishable (relatedContent)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(
      `{ article(id:"a1"){ relatedContent{ __typename ... on Article{ title } ... on Podcast{ title } } } }`,
    );
    expect(r).toEqual(N09);
  });

  it("N-10 entity interface Asset", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(
      `{ asset(id:"v1"){ __typename id url ... on VideoAsset{ transcodeProgress } } }`,
    );
    expect(r).toEqual(N10);
  });

  it("N-11 @inaccessible is hidden (negative)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ user(id:"u1"){ internalAuthToken } }`);
    // data must be absent or null; an error referencing internalAuthToken.
    expect(r.data ?? null).toBeNull();
    expect(Array.isArray(r.errors)).toBe(true);
    expect(r.errors[0].message).toContain("internalAuthToken");
    // TODO-OBSERVED: exact error message text is router/engine-dependent.
    // Tighten to a full toEqual on r.errors once the emitted message is seen.
  });

  it("N-12 @tag round-trips (type exists)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(`{ __type(name:"User"){ name } }`);
    expect(r).toEqual({ data: { __type: { name: "User" } } });
  });

  it("N-13 multiple keys (Subscription) then invoices", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(
      `{ organization(id:"o1"){ subscription{ id orgId planId status } invoices{ id amountCents paid } } }`,
    );
    expect(r).toEqual(N13);
  });

  it("N-14 deep cross-subgraph (accounts->reviews->recommendations)", { timeout: TIMEOUT }, async () => {
    const r = await postJSON(
      `{ user(id:"u1"){ displayName reviews{ rating } recommendedArticles{ title } } }`,
    );
    expect(r).toEqual(N14);
  });
});

// ---------------------------------------------------------------------------
// Defer-mode matrix (DT-01..DT-19)
// ---------------------------------------------------------------------------

describe("defer: single root-field defer (DT-01..DT-06)", () => {
  it("DT-01 single defer at root field, cross-subgraph entity", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id title ... @defer { reviews { id rating } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    // (b) exact initial payload.
    expect(initial.data).toEqual({ article: { id: "a1", title: "Hello World" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["article"] }]);

    // (c) exactly one incremental frame.
    expect(rest.length).toBe(1);
    const f = rest[0];
    expect(f.incremental).toEqual([
      { data: { reviews: [{ id: "r1", rating: 5 }, { id: "r2", rating: 3 }] }, id: "1" },
    ]);
    expect(f.completed).toEqual([{ id: "1" }]);
    expect(f.hasNext).toBe(false);

    // (d) round-trip.
    expect(reconstruct(r.frames)).toEqual(RT_DT01);
  });

  it("DT-02 defer between regular fields", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id ... @defer { reviews{ id rating } } title } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ article: { id: "a1", title: "Hello World" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["article"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { reviews: [{ id: "r1", rating: 5 }, { id: "r2", rating: 3 }] }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT01);
  });

  it("DT-03 all top-level fields deferred", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(`{ ... @defer { article(id:"a1"){ id title } } }`);
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({});
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: [] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { article: { id: "a1", title: "Hello World" } }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT03);
  });

  it("DT-04 @defer(if:true) explicit", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id title ... @defer(if:true) { reviews { id rating } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ article: { id: "a1", title: "Hello World" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["article"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { reviews: [{ id: "r1", rating: 5 }, { id: "r2", rating: 3 }] }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT01);
  });

  it("DT-05 @defer(if:false) -> single application/json", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id title ... @defer(if:false) { reviews { id rating } } } }`,
    );
    // (a) MUST be single application/json (if:false behaves as if absent).
    expect(r.mode).toBe("single");
    if (r.mode !== "single") return;

    // Full inline result, reviews resolved inline. Equals RT_DT01.
    expect(r.body).toEqual(RT_DT01);
  });

  it("DT-06 @defer(label:\"rev\")", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id title ... @defer(label:"rev") { reviews { id rating } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ article: { id: "a1", title: "Hello World" } });
    expect(initial.hasNext).toBe(true);
    // pending carries the label.
    expect(initial.pending).toEqual([{ id: "1", path: ["article"], label: "rev" }]);

    expect(rest.length).toBe(1);
    // label is NOT echoed on the incremental item in the new spec.
    expect(rest[0].incremental).toEqual([
      { data: { reviews: [{ id: "r1", rating: 5 }, { id: "r2", rating: 3 }] }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT01);
  });
});

describe("defer: parallel sibling defers (DT-07)", () => {
  it("DT-07 two parallel sibling defers (non-deterministic order)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id ...@defer{ reviews{ id } } ...@defer{ relatedContent{ __typename } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    expect(initial.data).toEqual({ article: { id: "a1" } });
    expect(initial.hasNext).toBe(true);
    // Both pending entries, path:["article"]; sorted by id ascending.
    expect(initial.pending).toEqual([
      { id: "1", path: ["article"] },
      { id: "2", path: ["article"] },
    ]);

    // Frame ordering is non-deterministic: collect incremental items by id.
    const byId = incrementalById(r.frames);
    // TODO-OBSERVED: id->fragment assignment (which defer is "1" vs "2")
    // follows defer declaration order per spec; verify after first run.
    expect(byId.get("1")).toEqual({ data: { reviews: [{ id: "r1" }, { id: "r2" }] }, id: "1" });
    expect(byId.get("2")).toEqual({
      data: { relatedContent: [{ __typename: "Article" }, { __typename: "Podcast" }] },
      id: "2",
    });

    // Exactly one frame carries hasNext:false.
    expectExactlyOneFinal(r.frames);

    expect(reconstruct(r.frames)).toEqual(RT_DT07);
  });
});

describe("defer: nested defer (DT-08)", () => {
  it("DT-08 nested defer (defer within defer)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ user(id:"u1"){ id ...@defer{ recommendedArticles{ id ...@defer{ reviews{ rating } } } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    expect(initial.data).toEqual({ user: { id: "u1" } });
    expect(initial.hasNext).toBe(true);
    // OBSERVED: nested defers are announced EAGERLY — both the outer (id "1")
    // and the inner (id "2") pending entries appear in the INITIAL payload.
    // The inner pending path is the static list path ["user","recommendedArticles"]
    // WITHOUT a list index; the index is carried later in the incremental subPath.
    expect(initial.pending).toEqual([
      { id: "1", path: ["user"] },
      { id: "2", path: ["user", "recommendedArticles"] },
    ]);

    // Outer frame: delivers recommendedArticles for id "1". No new pending is
    // introduced (everything was announced up front).
    const outer = r.frames.find((f) =>
      (f.incremental ?? []).some((i) => i.id === "1"),
    );
    expect(outer).toBeDefined();
    expect(outer!.incremental).toEqual([
      { data: { recommendedArticles: [{ id: "a2" }] }, id: "1" },
    ]);
    expect(outer!.completed).toEqual([{ id: "1" }]);
    expect(outer!.pending).toBeUndefined();
    expect(outer!.hasNext).toBe(true);

    // Inner frame: reviews for id "2", with subPath [0] reaching into the
    // recommendedArticles list element. a2.reviews = [r3], rating 4.
    const inner = r.frames.find((f) =>
      (f.incremental ?? []).some((i) => i.id === "2"),
    );
    expect(inner).toBeDefined();
    expect(inner!.incremental).toEqual([
      { data: { reviews: [{ rating: 4 }] }, id: "2", subPath: [0] },
    ]);
    expect(inner!.completed).toEqual([{ id: "2" }]);
    expect(inner!.hasNext).toBe(false);

    expectExactlyOneFinal(r.frames);
    expect(reconstruct(r.frames)).toEqual(RT_DT08);
  });
});

describe("defer: cross-subgraph entity (DT-09)", () => {
  it("DT-09 defer crossing onto an entity owned by another subgraph", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ user(id:"u1"){ displayName ...@defer{ reviews{ id rating } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ user: { displayName: "Alice Author" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["user"] }]);

    expect(rest.length).toBe(1);
    // u1.reviews = [r2, r3, r5].
    expect(rest[0].incremental).toEqual([
      {
        data: {
          reviews: [
            { id: "r2", rating: 3 },
            { id: "r3", rating: 4 },
            { id: "r5", rating: 2 },
          ],
        },
        id: "1",
      },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT09);
  });
});

describe("defer: @requires & @provides interactions (DT-10, DT-11)", () => {
  it("DT-10 defer on a @requires field (wordCount stays up front)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id wordCount ...@defer{ reviews{ readingTimeAdjusted } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    // wordCount (the @requires input) MUST be resolved up front.
    expect(initial.data).toEqual({ article: { id: "a1", wordCount: 400 } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["article"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { reviews: [{ readingTimeAdjusted: 7 }, { readingTimeAdjusted: 5 }] }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT10);
  });

  it("DT-11 defer on a @provides field", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ featuredArticle{ id ...@defer{ author{ displayName } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ featuredArticle: { id: "a1" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["featuredArticle"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { author: { displayName: "Alice Author" } }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT11);
  });
});

describe("defer: abstract types (DT-12 union, DT-13 interface)", () => {
  it("DT-12 defer fragment over a UNION (per-element, non-deterministic)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ search(term:"x"){ __typename ...on Article @defer { title wordCount } ...on Podcast @defer { durationSeconds } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    // Initial: each SearchResult has only __typename.
    expect(initial.data).toEqual({
      search: [
        { __typename: "Article" },
        { __typename: "Article" },
        { __typename: "Podcast" },
      ],
    });
    expect(initial.hasNext).toBe(true);
    // OBSERVED: one pending per @defer FRAGMENT (NOT per list element).
    // Two type-conditional defers -> ids "1" (on Article) and "2" (on Podcast),
    // both with the static list path ["search"]; the element index is carried
    // in each incremental item's subPath.
    expect(initial.pending).toEqual([
      { id: "1", path: ["search"] },
      { id: "2", path: ["search"] },
    ]);

    // Collect all incremental items across frames (frame ordering is
    // non-deterministic for parallel defers); key by id+subPath.
    const items12 = r.frames.flatMap((f) => f.incremental ?? []);
    const byKey12 = new Map(
      items12.map((i) => [`${i.id}|${JSON.stringify(i.subPath)}`, i]),
    );
    expect(items12.length).toBe(3);
    // Article defer (id "1") delivers both Article elements at indices 0 and 1.
    expect(byKey12.get("1|[0]")).toEqual({ data: { title: "Hello World", wordCount: 400 }, id: "1", subPath: [0] });
    expect(byKey12.get("1|[1]")).toEqual({ data: { title: "World News", wordCount: 1000 }, id: "1", subPath: [1] });
    // Podcast defer (id "2") delivers the Podcast element at index 2.
    expect(byKey12.get("2|[2]")).toEqual({ data: { durationSeconds: 1800 }, id: "2", subPath: [2] });
    // Both fragments complete.
    const completed12 = r.frames.flatMap((f) => f.completed ?? []).map((c) => c.id).sort();
    expect(completed12).toEqual(["1", "2"]);

    expectExactlyOneFinal(r.frames);
    expect(reconstruct(r.frames)).toEqual(RT_DT12);
  });

  it("DT-13 defer named-fragment spread over an INTERFACE (non-deterministic)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `query{ article(id:"a1"){ relatedContent{ __typename ...PubInfo @defer } } } fragment PubInfo on Publishable { title publishedAt }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    // relatedContent present with __typename only.
    expect(initial.data).toEqual({
      article: {
        relatedContent: [{ __typename: "Article" }, { __typename: "Podcast" }],
      },
    });
    expect(initial.hasNext).toBe(true);
    // OBSERVED: a single named-fragment defer over an interface yields ONE
    // pending entry (id "1") with the static list path ["article","relatedContent"];
    // each matched element arrives as a separate incremental item with subPath.
    expect(initial.pending).toEqual([
      { id: "1", path: ["article", "relatedContent"] },
    ]);

    const items13 = r.frames.flatMap((f) => f.incremental ?? []);
    const byKey13 = new Map(
      items13.map((i) => [`${i.id}|${JSON.stringify(i.subPath)}`, i]),
    );
    expect(items13.length).toBe(2);
    expect(byKey13.get("1|[0]")).toEqual({ data: { title: "World News", publishedAt: "2024-02-20T00:00:00Z" }, id: "1", subPath: [0] });
    expect(byKey13.get("1|[1]")).toEqual({ data: { title: "The Hello Podcast", publishedAt: "2024-03-10T00:00:00Z" }, id: "1", subPath: [1] });
    const completed13 = r.frames.flatMap((f) => f.completed ?? []).map((c) => c.id).sort();
    expect(completed13).toEqual(["1"]);

    expectExactlyOneFinal(r.frames);
    expect(reconstruct(r.frames)).toEqual(RT_DT13);
  });
});

describe("defer: @interfaceObject (DT-14)", () => {
  it("DT-14 defer onto @interfaceObject field (highest-risk)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id ...@defer{ stats{ views shares avgReadSeconds } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ article: { id: "a1" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["article"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { stats: { views: 1500, shares: 42, avgReadSeconds: 95.5 } }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT14);
  });
});

describe("defer: list elements (DT-15)", () => {
  it("DT-15 defer on each element of a list (subPath indices, non-deterministic)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ articles{ id ...@defer{ reviews{ id } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    expect(initial.data).toEqual({ articles: [{ id: "a1" }, { id: "a2" }] });
    expect(initial.hasNext).toBe(true);
    // TODO-OBSERVED: the router may emit ONE pending (path:["articles"]) with
    // per-element subPath frames, OR one pending per element. Assert exactly
    // what the router emits after first run; the round-trip stays hard.
    expect(Array.isArray(initial.pending)).toBe(true);

    // Collect incremental items keyed by id+subPath (one id reused per element).
    const byKey = incrementalById(r.frames);
    // Each element's reviews must arrive merged at its index. We assert the
    // union via the round-trip rather than guessing the id/subPath split.
    expect(byKey.size).toBeGreaterThanOrEqual(2);
    // TODO-OBSERVED: assert exact per-frame {id, subPath:[0]} / {id, subPath:[1]}
    // bodies once the router's id-numbering for list defers is observed.

    expectExactlyOneFinal(r.frames);
    expect(reconstruct(r.frames)).toEqual(RT_DT15);
  });
});

describe("defer: entity interface member (DT-16)", () => {
  it("DT-16 defer onto entity interface member", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ asset(id:"v1"){ __typename id ...on VideoAsset @defer { transcodeProgress } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ asset: { __typename: "VideoAsset", id: "v1" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["asset"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { transcodeProgress: 0.75 }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT16);
  });
});

describe("defer: composite-key entity (DT-17)", () => {
  it("DT-17 defer composite-key entity field", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ organization(id:"o1"){ id ...@defer{ subscription{ status seatUtilization } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const [initial, ...rest] = r.frames;
    expect(initial.data).toEqual({ organization: { id: "o1" } });
    expect(initial.hasNext).toBe(true);
    expect(initial.pending).toEqual([{ id: "1", path: ["organization"] }]);

    expect(rest.length).toBe(1);
    expect(rest[0].incremental).toEqual([
      { data: { subscription: { status: "active", seatUtilization: 0.75 } }, id: "1" },
    ]);
    expect(rest[0].completed).toEqual([{ id: "1" }]);
    expect(rest[0].hasNext).toBe(false);

    expect(reconstruct(r.frames)).toEqual(RT_DT17);
  });
});

describe("defer: characterization (DT-18)", () => {
  it("DT-18 non-deferrable field inside defer (characterization)", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id ...@defer { author { username } } } }`,
    );
    // Characterization: the router may fold the non-entity nested field into
    // the initial wave (single) OR still emit multipart. Either is acceptable;
    // the round-trip invariant is the only hard assertion.
    if (r.mode === "single") {
      // Folded into the initial wave.
      expect(r.body).toEqual(RT_DT18);
    } else {
      // Still multipart: round-trip must reconstruct the full object.
      // TODO-OBSERVED: record exact initial.data / pending / frame split.
      expect(reconstruct(r.frames)).toEqual(RT_DT18);
    }
  });
});

describe("defer: full-graph combination (DT-19)", () => {
  it("DT-19 multiple defers, mixed depth, full-graph", { timeout: TIMEOUT }, async () => {
    const r = await postDefer(
      `{ article(id:"a1"){ id title ...@defer{ reviews{ id } } ...@defer{ relatedContent{ __typename } } ...@defer{ stats{ views shares avgReadSeconds } } } }`,
    );
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;

    const initial = r.frames[0];
    expect(initial.data).toEqual({ article: { id: "a1", title: "Hello World" } });
    expect(initial.hasNext).toBe(true);
    // Three sibling defers, sorted by id ascending, all path:["article"].
    expect(initial.pending).toEqual([
      { id: "1", path: ["article"] },
      { id: "2", path: ["article"] },
      { id: "3", path: ["article"] },
    ]);

    // Non-deterministic ordering: collect incremental items by id.
    const byId = incrementalById(r.frames);
    // TODO-OBSERVED: id->fragment mapping (declaration order) — verify run 1.
    expect(byId.get("1")).toEqual({ data: { reviews: [{ id: "r1" }, { id: "r2" }] }, id: "1" });
    expect(byId.get("2")).toEqual({
      data: { relatedContent: [{ __typename: "Article" }, { __typename: "Podcast" }] },
      id: "2",
    });
    expect(byId.get("3")).toEqual({
      data: { stats: { views: 1500, shares: 42, avgReadSeconds: 95.5 } },
      id: "3",
    });

    // Exactly one hasNext:false across all frames.
    expectExactlyOneFinal(r.frames);

    expect(reconstruct(r.frames)).toEqual(RT_DT19);
  });
});
