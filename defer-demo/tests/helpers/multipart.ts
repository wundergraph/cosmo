// Multipart/mixed defer transport helper for the cosmo router.
//
// Implements the EXACT wire format from DESIGN.md §3:
//   Content-Type: multipart/mixed; deferSpec=20220824; boundary="graphql"
//   Each part: \r\n--graphql\r\nContent-Type: application/json\r\n\r\n<RAW JSON>
//   Terminator: \r\n--graphql--\r\n
//
// And the reconstruction algorithm from DESIGN.md §5.1, mirroring the Go
// reconstructDeferResponse: pending/incremental/completed/id/subPath model
// (engine graphql-go-tools v2 rc.267 — NOT the legacy 2022 path-on-item shape).

export const ROUTER_URL = process.env.ROUTER_URL ?? "http://localhost:3002/graphql";

// ---- Frame shapes (NEW incremental-delivery spec) -------------------------

export interface PendingEntry {
  id: string;
  path: (string | number)[];
  label?: string;
}

export interface IncrementalItem {
  data?: unknown;
  id: string;
  subPath?: (string | number)[];
  errors?: unknown[];
}

export interface CompletedEntry {
  id: string;
  errors?: unknown[];
}

export interface DeferFrame {
  data?: unknown;
  pending?: PendingEntry[];
  incremental?: IncrementalItem[];
  completed?: CompletedEntry[];
  hasNext?: boolean;
  errors?: unknown[];
}

export type DeferResult =
  | { mode: "single"; body: any; raw: string }
  | { mode: "multipart"; frames: DeferFrame[]; raw: string };

// ---- Transport ------------------------------------------------------------

export async function postDefer(
  query: string,
  variables?: Record<string, unknown>,
): Promise<DeferResult> {
  const res = await fetch(ROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "multipart/mixed",
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.startsWith("application/json")) {
    return { mode: "single", body: JSON.parse(raw), raw };
  }

  if (contentType.startsWith("multipart/mixed")) {
    return { mode: "multipart", frames: parseMultipart(raw), raw };
  }

  throw new Error(
    `Unexpected Content-Type: "${contentType}". Body:\n${raw.slice(0, 2000)}`,
  );
}

// Convenience: a plain JSON POST (no multipart Accept) for normal-mode cases.
export async function postJSON(
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  return JSON.parse(await res.text());
}

// ---- Multipart parsing (DESIGN §5.1 steps 1-2) ----------------------------

export function parseMultipart(raw: string): DeferFrame[] {
  // Split on the boundary. Live writer emits \r\n--graphql; tolerate bare \n.
  const parts = raw.split(/\r?\n--graphql/);

  const frames: DeferFrame[] = [];
  for (const part of parts) {
    // The terminator part begins with "--" (i.e. "--graphql--").
    if (part.startsWith("--")) continue;

    // Cut on the first blank line separating part headers from the body.
    const sepMatch = part.match(/\r?\n\r?\n/);
    if (!sepMatch) continue;
    const tail = part.slice(sepMatch.index! + sepMatch[0].length).trim();
    if (tail.length === 0) continue;

    frames.push(JSON.parse(tail) as DeferFrame);
  }

  return frames;
}

// ---- Reconstruction (DESIGN §5.1 steps 3-6) -------------------------------

export interface Reconstructed {
  data: unknown;
  errors?: unknown[];
}

// Merge frames back into a single {data, errors?} object equivalent to the
// normal-mode response, per DESIGN §5.1.
export function reconstruct(frames: DeferFrame[]): Reconstructed {
  if (frames.length === 0) {
    throw new Error("reconstruct: no frames");
  }

  const initial = frames[0];
  // step 3: build pendingPaths[id] = path from EVERY frame's pending[].
  const pendingPaths: Record<string, (string | number)[]> = {};
  for (const frame of frames) {
    for (const p of frame.pending ?? []) {
      pendingPaths[p.id] = p.path;
    }
  }

  // The accumulator starts from the initial payload's data.
  const root: any = { data: clone(initial.data ?? null) };
  const errors: unknown[] = [];
  for (const e of initial.errors ?? []) errors.push(e);

  // step 4: deep-merge each incremental item at
  //   ["data", ...pendingPaths[id], ...(item.subPath ?? [])].
  for (const frame of frames) {
    for (const item of frame.incremental ?? []) {
      const base = pendingPaths[item.id];
      if (base === undefined) {
        throw new Error(
          `reconstruct: incremental id "${item.id}" has no matching pending path`,
        );
      }
      const target = ["data", ...base, ...(item.subPath ?? [])];
      deepMergeAt(root, target, item.data);
      // step 5: hoist incremental[].errors into root errors.
      for (const e of item.errors ?? []) errors.push(e);
    }
    // step 5: hoist completed[].errors into root errors.
    for (const c of frame.completed ?? []) {
      for (const e of c.errors ?? []) errors.push(e);
    }
  }

  // step 6: drop hasNext & pending (already not copied); attach errors if any.
  const out: Reconstructed = { data: root.data };
  if (errors.length > 0) out.errors = errors;
  return out;
}

// ---- merge helpers --------------------------------------------------------

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Navigate `path` from the container, creating intermediate containers as
// needed, then deep-merge `value` into the location.
function deepMergeAt(container: any, path: (string | number)[], value: unknown): void {
  let node = container;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    if (node[key] === undefined || node[key] === null) {
      node[key] = typeof nextKey === "number" ? [] : {};
    }
    node = node[key];
  }
  const last = path[path.length - 1];
  node[last] = deepMerge(node[last], value);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (source === undefined) return target;
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(source)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  if (Array.isArray(target) && Array.isArray(source)) {
    const out = [...target];
    for (let i = 0; i < source.length; i++) {
      out[i] = deepMerge(out[i], source[i]);
    }
    return out;
  }
  return clone(source);
}
