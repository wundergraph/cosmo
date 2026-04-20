# Entity Caching — Visual Guide

## The Schema (3 Subgraphs)

```
┌─────────────────────────────────────────────────────────────────────┐
│  cachegraph (port 4012)                                             │
│                                                                     │
│  type Article @key(fields: "id") @openfed__entityCache(maxAge: 120) {       │
│    id: ID!                                                          │
│    title: String!                                                   │
│    body: String!                                                    │
│    authorName: String!                                              │
│    tags: [String!]!                                                 │
│  }                                                                  │
│                                                                     │
│  type Query {                                                       │
│    article(id: ID!): Article @openfed__queryCache(maxAge: 120)               │
│    articles: [Article!]! @openfed__queryCache(maxAge: 120)                   │
│    articlesByIds(                                                   │
│      ids: [ID!]! @openfed__is(fields: "id")                                  │
│    ): [Article!]! @openfed__queryCache(maxAge: 120)   ← batch isBatch=true  │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  cachegraph-ext (port 4013)                                         │
│                                                                     │
│  type Article @key(fields: "id") @openfed__entityCache(maxAge: 90) {        │
│    id: ID!                                                          │
│    viewCount: Int!                                                  │
│    rating: Float!                                                   │
│    reviewSummary: String!                                           │
│    relatedArticles: [Article!]!           ← field resolver          │
│    personalizedRecommendation: String     @requires(currentViewer)  │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  viewer (port 4014)                                                 │
│                                                                     │
│  type Personalized @key(fields: "id") @interfaceObject {           │
│    id: ID!                                                          │
│    currentViewer: Viewer @inaccessible                              │
│      @openfed__requestScoped(resolveFrom: ["Query.currentViewer"])           │
│            ↑                                                        │
│            └── L1 key: "viewer.Personalized.currentViewer"          │
│                When Query.currentViewer resolves, result is stored   │
│                in coordinate L1. All entity batches skip the fetch.  │
│  }                                                                  │
│                                                                     │
│  type Viewer @key(fields: "id") {                                  │
│    id: ID!   name: String!   email: String!                         │
│    recommendedArticles: [Article!]!                                  │
│  }                                                                  │
│                                                                     │
│  type Query {                                                       │
│    currentViewer: Viewer         ← provides @openfed__requestScoped value    │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## The Query

```graphql
{
  currentViewer {              # ← Root field on viewer subgraph
    id name email
    recommendedArticles {      # ← Viewer.recommendedArticles
      id title viewCount       #    (crosses to cachegraph + cachegraph-ext)
    }
  }
  articles {                   # ← Root field on cachegraph subgraph
    id title
    viewCount rating           # ← Extension fields from cachegraph-ext
    currentViewer { id name }  # ← @interfaceObject field from viewer
    relatedArticles {          # ← Field resolver from cachegraph-ext
      id title                 #    resolves back to cachegraph
    }
  }
}
```

This query touches **3 subgraphs**, returns **4 articles** each with extension fields,
viewer data, and related articles.
Without caching, this would require **7+ subgraph calls**.

## Request 1 — Cold Cache

```
 Step  Subgraph          Path                              What Happens
═══════════════════════════════════════════════════════════════════════════════════════
  1   ┌─ viewer          /                                 FETCH Query.currentViewer
      │                                                    → {id:"v0", name:"Anonymous", email:"..."}
      │                                                    ✦ EXPORT to requestScoped L1
      │                                                      key: "viewer.Personalized.currentViewer"
      │
  2   └─ cachegraph      /                                 FETCH Query.articles
                                                           → [{id:"1",...}, {id:"2",...}, ...]
                                                           L2 MISS → stored in L2 (TTL: 120s)

  3      cachegraph      currentViewer                     FETCH article entities for
                                                           Viewer.recommendedArticles
                                                           → resolves article entities

  4      cachegraph-ext  articles                          BATCH ENTITY FETCH (4 articles)
                                                           → {viewCount, rating, relatedArticles}
                                                           L2 MISS → stored in L2 (TTL: 90s)

  5      viewer          articles                          ★ SKIPPED! @openfed__requestScoped L1 HIT
                                                           ╔═══════════════════════════════════╗
                                                           ║  4 entities need currentViewer    ║
                                                           ║  L1 has it from step 1            ║
                                                           ║  → Inject cached value            ║
                                                           ║  → Skip viewer subgraph call      ║
                                                           ║  → 0ms, no network                ║
                                                           ╚═══════════════════════════════════╝

  6      cachegraph      articles.@.relatedArticles        BATCH ENTITY FETCH (8 articles)
                                                           → resolves related article entities
═══════════════════════════════════════════════════════════════════════════════════════
  Total network calls: 5 (would be 6+ without @openfed__requestScoped)
  Total time: ~6ms
```

## Request 2 — Warm Cache (Same Query)

```
 Step  Subgraph          Path                              What Happens
═══════════════════════════════════════════════════════════════════════════════════════
  1   ┌─ viewer          /                                 FETCH Query.currentViewer
      │                                                    (not cached — viewer has no @openfed__entityCache)
      │                                                    ✦ EXPORT to requestScoped L1
      │
  2   └─ cachegraph      /                                 ★ L2 HIT! (TTL: 120s)
                                                           articles data served from cache
                                                           → 0ms, no network

  3      cachegraph      currentViewer                     FETCH (viewer's recommended articles)

  4      cachegraph-ext  articles                          ★ L2 HIT! (TTL: 90s)
                                                           viewCount, rating, relatedArticles
                                                           all served from entity cache
                                                           → 0ms, no network

  5      viewer          articles                          ★ SKIPPED! @openfed__requestScoped L1 HIT
                                                           (same as request 1)

  6      cachegraph      articles.@.relatedArticles        ★ L2 HIT! (TTL: 120s)
                                                           related articles from entity cache
                                                           → 0ms, no network
═══════════════════════════════════════════════════════════════════════════════════════
  Total network calls: 2 (down from 5)
  Subgraph calls saved: 60%
```

## The Three Cache Layers at Work

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT REQUEST                               │
│  { currentViewer { ... } articles { ... currentViewer { ... } } }   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COSMO ROUTER                                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  @openfed__requestScoped Coordinate L1    (per-request, in-memory)   │   │
│  │                                                             │   │
│  │  "viewer.Personalized.currentViewer"                        │   │
│  │     → {id:"v0", name:"Anonymous", email:"..."}              │   │
│  │                                                             │   │
│  │  ✦ Populated from Query.currentViewer root field            │   │
│  │  ✦ Injected into ALL Personalized._entities batches         │   │
│  │  ✦ Eliminates redundant viewer subgraph calls               │   │
│  │  ✦ Field widening check: only inject if cached value        │   │
│  │    has ALL required sub-fields                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Entity L1 Cache            (per-request, in-memory)        │   │
│  │                                                             │   │
│  │  {"__typename":"Article","key":{"id":"1"}}                  │   │
│  │     → {title:"...", body:"...", viewCount:12453, ...}       │   │
│  │                                                             │   │
│  │  ✦ Populated from subgraph fetches within this request      │   │
│  │  ✦ Deduplicates same entity across parallel fetch paths     │   │
│  │  ✦ Checked before L2; L1 hit skips L2 entirely             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Entity L2 Cache            (cross-request, Ristretto)      │   │
│  │                                                             │   │
│  │  Article (TTL: 120s)  │  Article-ext (TTL: 90s)             │   │
│  │  ─────────────────────┼──────────────────────               │   │
│  │  id:1 → {title,...}   │  id:1 → {viewCount,rating,...}      │   │
│  │  id:2 → {title,...}   │  id:2 → {viewCount,rating,...}      │   │
│  │  id:3 → {title,...}   │  id:3 → {viewCount,rating,...}      │   │
│  │  id:4 → {title,...}   │  id:4 → {viewCount,rating,...}      │   │
│  │                                                             │   │
│  │  Root field (TTL: 120s)                                     │   │
│  │  ────────────────────                                       │   │
│  │  Query.articles → [{id:1},{id:2},{id:3},{id:4}]             │   │
│  │                                                             │   │
│  │  ✦ Populated after successful subgraph calls                │   │
│  │  ✦ Per-entity TTL from @openfed__entityCache(maxAge:)                │   │
│  │  ✦ Normalized field names for query-independent reuse       │   │
│  │  ✦ Validated before serving (missing fields → re-fetch)     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌──────────┐      ┌──────────────┐    ┌──────────┐
    │ cachegraph│      │cachegraph-ext│    │  viewer   │
    │ port 4012 │      │  port 4013   │    │ port 4014 │
    │           │      │              │    │           │
    │ Article   │      │ Article ext  │    │Personalized│
    │ (base)    │      │ (viewCount,  │    │(@interface │
    │           │      │  rating,     │    │  Object)  │
    │           │      │  related)    │    │           │
    └──────────┘      └──────────────┘    └──────────┘
```

## Before vs After: Subgraph Calls

```
                          Without Caching          With Entity Caching
                          ─────────────────        ─────────────────────

  Request 1 (cold)        7 subgraph calls         5 calls (viewer entity SKIPPED
                                                      via @openfed__requestScoped)

  Request 2 (warm)        7 subgraph calls         2 calls (L2 serves articles,
                                                      extensions, related articles;
                                                      @openfed__requestScoped skips viewer)

  Request 3+              7 subgraph calls         2 calls (same as R2 until
                                                      TTL expires)

  ────────────────────────────────────────────────────────────────────
  10 requests total       70 calls                 23 calls (67% reduction)
```

## Directive Reference

| Directive | Placement | Purpose |
|-----------|-----------|---------|
| `@openfed__entityCache(maxAge: Int!)` | `OBJECT` | Marks entity type as cacheable with TTL |
| `@openfed__queryCache(maxAge: Int!)` | `FIELD_DEFINITION` | Enables L2 cache reads for Query fields |
| `@openfed__is(fields: String!)` | `ARGUMENT_DEFINITION` | Maps argument to @key field for cache key |
| `@openfed__cacheInvalidate` | `FIELD_DEFINITION` | Evicts entity from cache (Mutation/Subscription) |
| `@openfed__cachePopulate(maxAge?: Int)` | `FIELD_DEFINITION` | Writes to cache (Mutation/Subscription) |
| `@openfed__requestScoped(resolveFrom: [String!], key: String)` | `FIELD_DEFINITION` | Eliminates redundant entity fetches via per-request L1 |

## Key Mapping Examples

```
 Schema                                     Config Output
 ──────                                     ─────────────

 @key(fields: "id")                         entityKeyField: "id"
 article(id: ID!)                           argumentPath: ["id"]
                                            (auto-mapped by name)

 @key(fields: "id")                         entityKeyField: "id"
 article(pid: ID! @openfed__is(fields: "id"))        argumentPath: ["pid"]
                                            (explicit @openfed__is mapping)

 @key(fields: "sellerId sku")               entityKeyField: "sellerId"
 listing(key: ListingKeyInput!              argumentPath: ["key","sellerId"]
   @openfed__is(fields: "sellerId sku"))             entityKeyField: "sku"
                                            argumentPath: ["key","sku"]
                                            (input object decomposition)

 @key(fields: "location { id }")            entityKeyField: "location.id"
 venue(loc: VenueLocInput!)                 argumentPath: ["loc","address","id"]
                                            (nested key + nested input)

 articlesByIds(ids: [ID!]!                  entityKeyField: "id"
   @openfed__is(fields: "id")): [Article!]!         argumentPath: ["ids"]
                                            isBatch: true
                                            (batch per-element cache keys)
```
