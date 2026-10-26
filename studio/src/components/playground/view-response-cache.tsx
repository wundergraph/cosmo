import { cn } from '@/lib/utils';
import { sentenceCase } from 'change-case';
import { ReactNode, useEffect, useState } from 'react';
import { CodeViewer } from '../code-viewer';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import {
  CachedFetch,
  InvalidationRequest,
  ResponseCacheEntry,
  ResponseCacheInvalidation,
  ResponseCacheRequestTrace,
  ResponseCacheStatus,
  ResponseCacheTrace,
  entryLabel,
  invalidationCurl,
  InvalidationResult,
  isRootFetch,
  mergedEntrySummary,
  operationInvalidationRequests,
  responseCacheStatusLabel,
  sendInvalidation,
  subgraphInvalidationId,
} from './response-cache-trace';

export const ResponseCacheBadge = ({ status }: { status: ResponseCacheStatus }) => {
  const variant =
    status === 'hit' ? 'success' : status === 'partial_hit' ? 'secondary' : status === 'miss' ? 'outline' : 'muted';
  return <Badge variant={variant}>{responseCacheStatusLabel(status)}</Badge>;
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <p className="flex gap-x-2">
    <span className="shrink-0 text-muted-foreground">{label}:</span>
    <span className="min-w-0 break-all">{children}</span>
  </p>
);

const List = ({ label, items }: { label: string; items?: string[] }) =>
  items && items.length > 0 ? <Row label={label}>{items.join(', ')}</Row> : null;

const CopyBlock = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded border bg-muted/40">
      <pre className="scrollbar-custom overflow-auto p-3 pr-16 text-xs">{text}</pre>
      <Button
        variant="secondary"
        size="sm"
        className="absolute right-2 top-2"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
};

const EntryResult = ({ entry }: { entry: ResponseCacheEntry }) =>
  entry.served ? (
    <Badge variant="success">Served</Badge>
  ) : entry.found ? (
    <Badge variant="secondary">Found, not used</Badge>
  ) : (
    <Badge variant="outline">Not found</Badge>
  );

const Entry = ({ entry, kind }: { entry: ResponseCacheEntry; kind?: string }) => {
  return (
    <div className="flex flex-col gap-y-1 rounded-md border p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {entryLabel(entry, kind)}
          {entry.typeName && <span className="ml-2 font-normal text-muted-foreground">{entry.typeName}</span>}
        </span>
        <EntryResult entry={entry} />
        {entry.written && <Badge variant="secondary">Written</Badge>}
        {(entry.private || entry.writtenPrivate) && <Badge variant="muted">Private</Badge>}
      </div>
      {isRootFetch(kind) && (
        <p className="text-muted-foreground">
          Root fields have no type: only subgraph or cache tag invalidation drops them.
        </p>
      )}
      {entry.remainingTTL && <Row label="Remaining TTL">{entry.remainingTTL}</Row>}
      {entry.writeTTL && <Row label={entry.written ? 'Write TTL' : 'Attempted TTL'}>{entry.writeTTL}</Row>}
      <Row label="Key">
        <code className="text-xs">{entry.writtenKey || entry.key}</code>
      </Row>
      {entry.privateKey && (
        <Row label="Private key">
          <code className="text-xs">{entry.privateKey}</code>
        </Row>
      )}
      <List label="Declared tags" items={entry.declaredTags} />
      <List label="Surrogate keys" items={entry.surrogateKeys} />
      <List label="Index tags" items={entry.tags} />
      {entry.vary && entry.vary.length > 0 && (
        <Row label="Vary">{entry.vary.map((s) => s.join(' + ')).join(' | ')}</Row>
      )}
      {entry.value !== undefined && (
        <details className="mt-1">
          <summary className="cursor-pointer text-primary">Cached value</summary>
          <div className="mt-2 rounded border">
            <CodeViewer code={JSON.stringify(entry.value)} language="json" />
          </div>
        </details>
      )}
    </div>
  );
};

// MergedEntries shows which entries of a merged fetch came from the cache.
const MergedEntries = ({ trace }: { trace: ResponseCacheTrace }) => {
  const merged = mergedEntrySummary(trace);
  if (merged.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-y-1">
      <h2 className="mb-1 text-base font-medium">Merged fetch</h2>
      {merged.map((m) => (
        <p key={m.name} className="flex items-center gap-x-2">
          <span className="min-w-0 break-all">{m.name}</span>
          <ResponseCacheBadge status={m.served === m.total ? 'hit' : m.served === 0 ? 'miss' : 'partial_hit'} />
          <span className="text-muted-foreground">
            {m.served} / {m.total} from cache
          </span>
        </p>
      ))}
    </div>
  );
};

export const ViewResponseCache = ({
  responseCache,
  kind,
  asChild,
}: {
  responseCache: ResponseCacheTrace;
  kind?: string;
  asChild?: boolean;
}) => {
  return (
    <Dialog>
      <DialogTrigger asChild={asChild} className={cn(!asChild && 'text-primary')}>
        {asChild ? (
          <Button variant="secondary" size="sm" className="flex-1">
            <span className="flex-shrink-0">View Cache</span>
          </Button>
        ) : (
          'View Cache'
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-x-3">
            Response Cache <ResponseCacheBadge status={responseCache.status} />
          </DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom flex max-h-[70vh] flex-col gap-y-4 overflow-auto text-sm">
          <div className="flex flex-col gap-y-1">
            {responseCache.storeDecision && (
              <Row label="Store decision">{sentenceCase(responseCache.storeDecision)}</Row>
            )}
            {responseCache.keysRequested > 0 && (
              <Row label="Keys found">
                {responseCache.keysFound} / {responseCache.keysRequested}
              </Row>
            )}
            {responseCache.lookupDuration && <Row label="Lookup">{responseCache.lookupDuration}</Row>}
            {responseCache.privateId && <Row label="Private id">applied</Row>}
            {responseCache.cacheControl && <Row label="Subgraph Cache-Control">{responseCache.cacheControl}</Row>}
            {responseCache.vary && <Row label="Subgraph Vary">{responseCache.vary}</Row>}
            {responseCache.writeError && (
              <Row label="Write error">
                <span className="text-destructive">{responseCache.writeError}</span>
              </Row>
            )}
          </div>
          <MergedEntries trace={responseCache} />
          {responseCache.entries.map((entry) => (
            <Entry key={`${entry.alias ?? ''}-${entry.index}`} entry={entry} kind={kind} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const grid = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_8rem_5rem_5rem] items-center gap-x-3';

// Entries lists every entry of the operation; a row expands to its details.
const Entries = ({ fetches }: { fetches: CachedFetch[] }) => {
  const rows = fetches.flatMap((f) => f.trace.entries.map((entry) => ({ ...f, entry })));
  const notCacheable = fetches.filter((f) => f.trace.status === 'not_cacheable');
  return (
    <div className="flex flex-col gap-y-1">
      <h2 className="mb-1 text-base font-medium">Entries</h2>
      {rows.length === 0 && <p className="text-muted-foreground">None</p>}
      {rows.length > 0 && (
        <div className="flex flex-col rounded-md border text-xs">
          <div className={cn(grid, 'border-b px-3 py-2 pl-7 text-muted-foreground')}>
            <span>Subgraph</span>
            <span>Entry</span>
            <span>Result</span>
            <span>Stored</span>
            <span>TTL</span>
          </div>
          {rows.map(({ subgraph, kind, entry }, i) => (
            <details key={i} className="group border-b last:border-b-0">
              <summary className="cursor-pointer list-none px-3 py-2 hover:bg-muted/40">
                <div className="flex items-center gap-x-2">
                  <span className="w-3 text-muted-foreground group-open:rotate-90">›</span>
                  <div className={cn(grid, 'flex-1')}>
                    <span className="truncate">{subgraph}</span>
                    <span className="truncate">
                      {entryLabel(entry, kind)}
                      {entry.typeName && <span className="ml-2 text-muted-foreground">{entry.typeName}</span>}
                    </span>
                    <span>
                      <EntryResult entry={entry} />
                    </span>
                    <span>{entry.written ? 'yes' : '-'}</span>
                    <span>{entry.remainingTTL ?? entry.writeTTL ?? '-'}</span>
                  </div>
                </div>
              </summary>
              <div className="px-3 pb-3">
                <Entry entry={entry} kind={kind} />
              </div>
            </details>
          ))}
        </div>
      )}
      {notCacheable.length > 0 && (
        <p className="text-muted-foreground">
          Not cacheable:{' '}
          {notCacheable.map((f) => `${f.subgraph} (${sentenceCase(f.trace.storeDecision ?? 'unknown')})`).join(', ')}
        </p>
      )}
    </div>
  );
};

// The shared key lives for the browser tab only, per endpoint origin.
const sharedKeyStorage = 'cosmo-playground-invalidation-shared-key';

const originOf = (endpoint: string) => {
  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
};

const readSharedKey = (origin: string) => {
  if (!origin) {
    return '';
  }
  try {
    return sessionStorage.getItem(`${sharedKeyStorage}:${origin}`) ?? '';
  } catch {
    return '';
  }
};

const writeSharedKey = (origin: string, key: string) => {
  if (!origin) {
    return;
  }
  try {
    sessionStorage.setItem(`${sharedKeyStorage}:${origin}`, key);
  } catch {}
};

// ViewResponseCacheInvalidate builds one invalidation request from targets picked across the operation.
export const ViewResponseCacheInvalidate = ({
  fetches,
  invalidation,
}: {
  fetches: CachedFetch[];
  invalidation?: ResponseCacheInvalidation;
}) => {
  const groups = operationInvalidationRequests(fetches, invalidation);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<InvalidationResult>();
  // Editable: the advertised URL may not be reachable from this browser.
  const [endpoint, setEndpoint] = useState(invalidation?.endpoint ?? '');
  useEffect(() => {
    setEndpoint(invalidation?.endpoint ?? '');
  }, [invalidation?.endpoint]);
  // Never offer one router's key to another.
  const endpointOrigin = originOf(endpoint);
  const [sharedKey, setSharedKey] = useState(() => readSharedKey(endpointOrigin));
  useEffect(() => {
    setSharedKey(readSharedKey(endpointOrigin));
  }, [endpointOrigin]);
  // A new response starts a new selection.
  useEffect(() => {
    setSelected(new Set());
    setResult(undefined);
  }, [fetches]);
  if (groups.length === 0) {
    return null;
  }
  // Picking a whole subgraph covers its finer options.
  const covered = (r: InvalidationRequest, subgraph: string) =>
    r.id !== subgraphInvalidationId(subgraph) && selected.has(subgraphInvalidationId(subgraph));
  const picked = groups.flatMap((g) => g.requests.filter((r) => selected.has(r.id) && !covered(r, g.subgraph)));
  const toggle = (r: InvalidationRequest) => {
    setResult(undefined);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(r.id) ? next.delete(r.id) : next.add(r.id);
      return next;
    });
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Invalidate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invalidate</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom flex max-h-[70vh] flex-col gap-y-4 overflow-auto text-sm">
          <p className="text-muted-foreground">
            Pick what to drop from the cache. This applies to every operation, not only this one; counts are the entries
            in this response.
          </p>
          {groups.map((g) => (
            <div key={g.subgraph} className="flex flex-col gap-y-2">
              <h2 className="flex items-center gap-x-2 font-medium">
                {g.subgraph}
                <Badge variant="muted">subgraph</Badge>
              </h2>
              {g.rootEntries > 0 && (
                <p className="text-xs text-muted-foreground">
                  Includes a root field response, which has no type: only{' '}
                  {invalidation?.subgraph ? `everything from ${g.subgraph} or a cache tag` : 'a cache tag'} drops it.
                </p>
              )}
              {g.requests.length > 0 && (
                <div className="flex flex-col rounded-md border">
                  {g.requests.map((r) => {
                    const isCovered = covered(r, g.subgraph);
                    return (
                      <label
                        key={r.id}
                        className={cn(
                          'flex items-start gap-x-3 border-b px-3 py-2 last:border-b-0',
                          isCovered ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40',
                        )}
                      >
                        <Checkbox
                          className="mt-0.5 border-foreground/60"
                          checked={isCovered || selected.has(r.id)}
                          disabled={isCovered || sending}
                          onCheckedChange={() => toggle(r)}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span>{r.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {isCovered ? `Included in everything from ${g.subgraph}.` : r.description}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.entries} {r.entries === 1 ? 'entry' : 'entries'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {!invalidation?.endpoint ? (
            <p className="text-muted-foreground">Enable the invalidation endpoint to get invalidation commands.</p>
          ) : picked.length > 0 ? (
            <div className="flex flex-col gap-y-3">
              <input
                type="url"
                aria-label="Invalidation endpoint"
                placeholder="Invalidation endpoint"
                value={endpoint}
                onChange={(e) => {
                  setEndpoint(e.target.value);
                  setResult(undefined);
                }}
                className="h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex items-center gap-x-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Invalidation shared key"
                  value={sharedKey}
                  onChange={(e) => {
                    setSharedKey(e.target.value);
                    writeSharedKey(endpointOrigin, e.target.value);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  size="sm"
                  disabled={!endpoint || !sharedKey || sending}
                  onClick={async () => {
                    setSending(true);
                    setResult(await sendInvalidation(endpoint, sharedKey, picked));
                    setSending(false);
                  }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </div>
              {result && (
                <p className={cn('text-sm', result.ok ? 'text-success' : 'text-destructive')}>{result.message}</p>
              )}
              {result?.ok && (
                <p className="text-xs text-muted-foreground">Run the operation again to see the misses.</p>
              )}
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">Copy as curl</summary>
                <div className="mt-2 flex flex-col gap-y-1">
                  <span className="text-xs text-muted-foreground">
                    Set INVALIDATION_SHARED_KEY to the router&apos;s invalidation shared key, then run:
                  </span>
                  <CopyBlock text={invalidationCurl(endpoint, picked)} />
                </div>
              </details>
            </div>
          ) : (
            <p className="text-muted-foreground">Select at least one option to get the curl command.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const ViewResponseCacheRequest = ({
  trace,
  fetches,
}: {
  trace: ResponseCacheRequestTrace;
  fetches: CachedFetch[];
}) => {
  const tagHeader = trace.tagHeader;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Response Cache
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Response Cache</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom flex max-h-[70vh] flex-col gap-y-4 overflow-auto text-sm">
          <Entries fetches={fetches} />
          <div className="flex flex-col gap-y-1">
            <h2 className="mb-1 text-base font-medium">Surrogate keys</h2>
            {trace.surrogateKeys.length > 0 ? (
              <p className="break-all">{trace.surrogateKeys.join(', ')}</p>
            ) : (
              <p className="text-muted-foreground">None</p>
            )}
          </div>
          {tagHeader && (
            <div className="flex flex-col gap-y-1">
              <h2 className="mb-1 flex items-center gap-x-2 text-base font-medium">
                {tagHeader.name} header
                <Badge variant={tagHeader.outcome === 'truncated' ? 'destructive' : 'secondary'}>
                  {sentenceCase(tagHeader.outcome)}
                </Badge>
              </h2>
              <Row label="Emitted">{tagHeader.emitted ? 'yes' : 'no'}</Row>
              <Row label="Size">
                {tagHeader.size} of {tagHeader.untruncatedSize} bytes (max {tagHeader.maxBytes})
              </Row>
              {tagHeader.value && <Row label="Value">{tagHeader.value}</Row>}
              <List label="Dropped (over max bytes)" items={tagHeader.dropped} />
              <List label="Rejected (cannot be sent)" items={tagHeader.rejected} />
              {!tagHeader.emitted && tagHeader.value && (
                <p className="text-muted-foreground">
                  Not sent: the response has subgraph errors, or is not a plain response (defer, subscription).
                </p>
              )}
            </div>
          )}
          {trace.invalidation && (
            <div className="flex flex-col gap-y-1">
              <h2 className="mb-1 text-base font-medium">Invalidation</h2>
              <Row label="Indexes">
                {[
                  trace.invalidation.cacheTag && 'cache_tag',
                  trace.invalidation.type && 'type',
                  trace.invalidation.subgraph && 'subgraph',
                ]
                  .filter(Boolean)
                  .join(', ') || 'none'}
              </Row>
              <Row label="Endpoint">{trace.invalidation.endpoint ?? 'disabled'}</Row>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
