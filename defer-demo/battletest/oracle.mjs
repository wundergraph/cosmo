#!/usr/bin/env node
// Canonical @defer oracle harness — the single source of truth both the codex
// fuzzer-workers and the opus verifier use, so a "finding" means the same thing
// to everyone. Spec-free where possible: @defer is pure transport reformatting
// of a result whose canonical value is the NON-defer response.
//
// Usage:
//   node oracle.mjs '<graphql query>' ['<variables json>']      # single op -> verdict JSON
//   node oracle.mjs --corpus path/to/ops.jsonl                  # batch; prints one verdict JSON per line
//   ROUTER_URL=http://localhost:3002/graphql node oracle.mjs ...
//
// Verdict shape: { ok, validOp, deferMode, failures:[{oracle,detail,signature}], signature, query, variables }
// Exit code 0 always (this is an oracle, not a test runner); read the JSON.

const ROUTER = process.env.ROUTER_URL || "http://localhost:3002/graphql";
const TIMEOUT_MS = Number(process.env.ORACLE_TIMEOUT_MS || 20000);

// ---------- transport ----------
async function post(query, variables, defer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(ROUTER, {
      method: "POST",
      headers: { "content-type": "application/json", ...(defer ? { accept: "multipart/mixed" } : {}) },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { networkError: String(e && e.name === "AbortError" ? "TIMEOUT" : (e && e.message) || e) };
  }
  const ctype = r.headers.get("content-type") || "";
  let text;
  try { text = await r.text(); } catch (e) { clearTimeout(timer); return { status: r.status, ctype, networkError: "BODY_READ:" + ((e && e.message) || e) }; }
  clearTimeout(timer);
  if (!ctype.includes("multipart")) {
    let json; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ctype, mode: "single", json, raw: text };
  }
  const frames = [];
  let parseErr = null;
  for (const part of text.split(/\r?\n--graphql/)) {
    const i = part.indexOf("\r\n\r\n") >= 0 ? part.indexOf("\r\n\r\n") + 4 : (part.indexOf("\n\n") >= 0 ? part.indexOf("\n\n") + 2 : -1);
    if (i < 0) continue;
    const body = part.slice(i).trim();
    if (!body || body.startsWith("--")) continue;
    try { frames.push(JSON.parse(body)); } catch (e) { parseErr = (e && e.message) || String(e); }
  }
  return { status: r.status, ctype, mode: "multipart", frames, raw: text, parseErr };
}

// ---------- helpers ----------
function stripDefer(query) {
  // remove @defer / @stream directives (with optional args) to get the canonical non-incremental query
  return query.replace(/@(defer|stream)\s*(\([^)]*\))?/g, "");
}
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
function stable(x) {
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  if (isObj(x)) return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stable(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
const eq = (a, b) => stable(a) === stable(b);
function merge(t, s) {
  for (const k of Object.keys(s)) {
    if (isObj(s[k]) && isObj(t[k])) merge(t[k], s[k]);
    else if (Array.isArray(s[k]) && Array.isArray(t[k])) s[k].forEach((v, i) => { if (isObj(v) && isObj(t[k][i])) merge(t[k][i], v); else t[k][i] = v; });
    else t[k] = s[k];
  }
  return t;
}
function getAt(root, path) { let c = root; for (const seg of path) { if (c[seg] === undefined) c[seg] = typeof seg === "number" ? [] : {}; c = c[seg]; } return c; }
function reconstruct(frames) {
  const root = { data: JSON.parse(JSON.stringify(frames[0] && frames[0].data || {})) };
  const errs = [];
  const pend = {};
  for (const f of frames) for (const p of (f.pending || [])) pend[p.id] = p.path;
  for (const f of frames) {
    for (const it of (f.incremental || [])) {
      const path = ["data", ...(pend[it.id] || []), ...(it.subPath || [])];
      if (it.data !== undefined) merge(getAt(root, path), it.data);
      if (it.errors) errs.push(...it.errors);
    }
    for (const c of (f.completed || [])) if (c.errors) errs.push(...c.errors);
  }
  if (frames[0] && frames[0].errors) errs.unshift(...frames[0].errors);
  if (errs.length) root.errors = errs;
  return root;
}
function errSet(errors) {
  return (errors || []).map((e) => (e.message || "") + "" + JSON.stringify(e.path || null)).sort();
}
function sha(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }

// ---------- the oracles ----------
async function judge(query, variables) {
  const fail = [];
  const normalQ = stripDefer(query);
  const [n, d] = await Promise.all([post(normalQ, variables, false), post(query, variables, true)]);

  // O0 crash/hang oracle (applies always): any 5xx, panic, or hang on the op is a fault.
  for (const [label, resp] of [["normal", n], ["defer", d]]) {
    if (resp.networkError === "TIMEOUT") fail.push({ oracle: "crash/hang", detail: label + " timed out with no terminal frame (>" + TIMEOUT_MS + "ms)" });
    else if (resp.networkError) fail.push({ oracle: "crash/hang", detail: label + " transport error: " + resp.networkError });
    else if (resp.status >= 500) fail.push({ oracle: "crash/hang", detail: label + " HTTP " + resp.status + " (empty/err body len=" + ((resp.raw || "").length) + ")" });
  }
  if (d.parseErr) fail.push({ oracle: "framing", detail: "multipart part failed to JSON.parse: " + d.parseErr });

  // classify op validity from the NORMAL run
  const normalOk = n.status === 200 && n.json && (n.json.data !== undefined || n.json.errors);
  const validOp = normalOk && n.json.data !== undefined; // produced data (not a pure validation rejection)

  // Build defer reconstruction (single-mode = the lone payload)
  let recon = null, frames = null;
  if (d.mode === "multipart" && Array.isArray(d.frames) && d.frames.length) {
    frames = d.frames;
    recon = reconstruct(frames);

    // Protocol invariants only apply when the op produced a valid deferred result.
    // An INVALID op (validation/parse error) may return a lone error frame — not a bug.
    if (validOp) {
    // O2 terminal-frame invariant
    const finals = frames.filter((f) => f.hasNext === false);
    const lastIdx = frames.length - 1;
    if (finals.length !== 1) fail.push({ oracle: "terminal-frame", detail: finals.length + " frames with hasNext:false (expected exactly 1)" });
    else if (frames[lastIdx].hasNext !== false) fail.push({ oracle: "terminal-frame", detail: "terminal frame is not the last frame" });
    for (let i = 0; i < lastIdx; i++) if (frames[i].hasNext === false) fail.push({ oracle: "terminal-frame", detail: "non-final frame " + i + " has hasNext:false" });

    // O3 pending-completion closure
    const announced = new Set(), completed = [];
    for (const f of frames) for (const p of (f.pending || [])) announced.add(String(p.id));
    for (const f of frames) for (const c of (f.completed || [])) completed.push(String(c.id));
    const compSet = new Set(completed);
    for (const id of announced) if (!compSet.has(id)) fail.push({ oracle: "pending-closure", detail: "pending id " + id + " announced but never completed (defer hang/drop)" });
    for (const id of completed) if (!announced.has(id)) fail.push({ oracle: "pending-closure", detail: "completed id " + id + " was never pending" });
    const seen = new Set();
    for (const id of completed) { if (seen.has(id)) fail.push({ oracle: "pending-closure", detail: "id " + id + " completed more than once" }); seen.add(id); }

    // O4 path validity: every pending path must resolve in the reconstruction root
    for (const f of frames) for (const p of (f.pending || [])) {
      let c = recon.data, okp = true;
      for (const seg of (p.path || [])) { if (c == null || c[seg] === undefined) { okp = false; break; } c = c[seg]; }
      if (!okp) fail.push({ oracle: "path-validity", detail: "pending path " + JSON.stringify(p.path) + " (id " + p.id + ") does not resolve in merged result" });
    }
    } // end validOp protocol invariants
  } else if (d.mode === "single" && d.json) {
    recon = d.json; // if:false / non-incremental collapse
  }

  // Data + error oracles require a valid baseline AND a defer payload we could read
  if (validOp && recon) {
    // O1 reconstruction-equivalence (PRIMARY)
    if (!eq(recon.data, n.json.data)) {
      fail.push({ oracle: "reconstruction", detail: "merged defer result != normal-mode data" , diff: { normal: n.json.data, recon: recon.data } });
    }
    // O5 error parity (order-independent set of message+path)
    const ne = errSet(n.json.errors), de = errSet(recon.errors);
    if (stable(ne) !== stable(de)) fail.push({ oracle: "error-parity", detail: "error set differs", normalErrors: ne, deferErrors: de });
  }

  // de-dup signature: which oracles fired + coarse shape, NOT the exact query (so the same
  // bug from different queries buckets together). Includes normalized error/status context.
  const firedOracles = [...new Set(fail.map((f) => f.oracle))].sort();
  const sigBasis = firedOracles.join("+") + "|" + (d.status || 0) + "/" + (n.status || 0) + "|" +
    (fail.map((f) => (f.detail || "").replace(/\d+/g, "#").replace(/id #/g, "id ").slice(0, 80)).sort().join(";"));
  const signature = firedOracles.length ? firedOracles.join("+") + ":" + sha(sigBasis) : null;

  return {
    ok: fail.length === 0,
    validOp,
    deferMode: d.mode || (d.networkError ? "error" : "?"),
    failures: fail,
    signature,
    query,
    variables: variables || null,
  };
}

// ---------- CLI ----------
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--corpus") {
    const fs = await import("node:fs");
    const lines = fs.readFileSync(args[1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const v = await judge(rec.query, rec.variables);
      if (rec.id) v.id = rec.id;
      if (rec.tags) v.tags = rec.tags;
      process.stdout.write(JSON.stringify(v) + "\n");
    }
    return;
  }
  const query = args[0];
  if (!query) { console.error("usage: node oracle.mjs '<query>' ['<variables json>']  | node oracle.mjs --corpus file.jsonl"); process.exit(2); }
  let variables = null;
  if (args[1]) { try { variables = JSON.parse(args[1]); } catch { console.error("bad variables json"); process.exit(2); } }
  const v = await judge(query, variables);
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
}
main().catch((e) => { console.error("oracle fatal:", e); process.exit(2); });
