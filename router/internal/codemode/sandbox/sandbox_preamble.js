"use strict";

const tools = {};
for (const name of __HOST_TOOL_NAMES) {
  tools[name] = async (vars) => {
    const __hostPayload = await __hostInvokeTool(name, vars);
    const __hostResult = JSON.parse(__hostPayload);
    if (__hostResult?.__codemodeHostError) {
      const e = new Error(__hostResult.__codemodeHostError.message);
      e.name = __hostResult.__codemodeHostError.name;
      throw e;
    }
    return __hostResult;
  };
}
Object.freeze(tools);
globalThis.tools = tools;

const __consoleErr = () => {
  const e = new Error(
    "console is not available in this sandbox. " +
    "Include diagnostics in your return value, e.g. `return { result, debug: { ... } }`."
  );
  e.name = "ConsoleUnavailable";
  throw e;
};
globalThis.console = new Proxy({}, {
  get: () => __consoleErr,
});

Math.random = () => 0;
Date.now = () => 0;

const __OrigDate = Date;
const __PinnedDate = function Date(...args) {
  return args.length === 0 ? new __OrigDate(0) : new __OrigDate(...args);
};
Object.setPrototypeOf(__PinnedDate, __OrigDate);
__PinnedDate.prototype = __OrigDate.prototype;
__PinnedDate.now   = () => 0;
__PinnedDate.UTC   = __OrigDate.UTC;
__PinnedDate.parse = __OrigDate.parse;
globalThis.Date = __PinnedDate;

globalThis.notNull = (v, msg) => {
  if (v == null) throw new Error(msg ?? "notNull: value was null/undefined");
  return v;
};
globalThis.compact = (v) => {
  if (Array.isArray(v)) return v.map(compact).filter((x) => x != null);
  if (v && typeof v === "object") {
    const out = {};
    for (const k in v) {
      const c = compact(v[k]);
      if (c != null) out[k] = c;
    }
    return out;
  }
  return v;
};

delete globalThis.eval;
delete globalThis.Function;
// Also remove indirect access via the Function constructor on the function prototype.
// (Function.prototype.constructor still exists per JS spec, but with eval/Function deleted
// it no longer resolves to a usable constructor.)

// Splice point: Execute.WrappedJS is already harness-wrapped and transpiled.
const __agentMain = (__AGENT_MAIN_SPLICE__);
(async () => {
  try { return { ok: true, result: await __agentMain() }; }
  catch (err) {
    return { ok: false, error: { name: err?.name ?? "Error", message: err?.message ?? String(err), stack: err?.stack ?? "", cause: err?.cause } };
  }
})()
