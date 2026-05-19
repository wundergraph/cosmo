package sandbox

import (
	"encoding/json"
	"fmt"

	"github.com/fastschema/qjs"
)

const validationHelpers = `
globalThis.__codemodeNormalizeError = (err, depth = 0) => {
  if (!err) return null;
  if (depth >= 5) return { name: "TruncatedCause", message: "cause chain exceeded depth 5", stack: "" };
  return {
    name: err?.name ?? "Error",
    message: err?.message ?? String(err),
    stack: err?.stack ?? "",
    cause: err?.cause ? __codemodeNormalizeError(err.cause, depth + 1) : null,
  };
};
globalThis.__codemodeNormalizeErrorJSON = (err) => JSON.stringify(__codemodeNormalizeError(err));

globalThis.__codemodeValidateResult = (value) => {
  const warnings = [];
  const seen = new WeakSet();
  const keyPath = (base, key) => {
    if (typeof key === "number") return base + "[" + key + "]";
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? base + "." + key : base + "[" + JSON.stringify(key) + "]";
  };
  const sentinel = (kind) => "<<non-serializable: " + kind + ">>";
  const walk = (v, path, parent, key) => {
    const t = typeof v;
    if (t === "bigint" || t === "function" || t === "symbol" || t === "undefined") {
      parent[key] = sentinel(t);
      warnings.push({ path, kind: t });
      return;
    }
    if (v && t === "object") {
      if (seen.has(v)) {
        parent[key] = sentinel("cycle");
        warnings.push({ path, kind: "cycle" });
        return;
      }
      seen.add(v);
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i], keyPath(path, i), v, i);
        return;
      }
      for (const k of Object.keys(v)) walk(v[k], keyPath(path, k), v, k);
    }
  };
  const root = { value };
  walk(root.value, "$", root, "value");
  try {
    const json = JSON.stringify(root.value);
    if (json === undefined) {
      return JSON.stringify({ ok: false, warnings, error: "value serialized to undefined" });
    }
    return JSON.stringify({ ok: true, json, warnings });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return JSON.stringify({ ok: false, warnings, error: msg });
  }
};
`

type validationOutcome struct {
	OK       bool                   `json:"ok"`
	JSON     string                 `json:"json"`
	Warnings []SerializationWarning `json:"warnings"`
	Error    string                 `json:"error"`
}

func installValidationHelpers(ctx *qjs.Context) error {
	val, err := ctx.Eval("codemode_validation.js", qjs.Code(validationHelpers))
	_ = val
	return err
}

func validateResult(ctx *qjs.Context, result *qjs.Value, maxOutputBytes int) (json.RawMessage, []SerializationWarning, *ErrorEnvelope, error) {
	global := ctx.Global()
	validator := global.GetPropertyStr("__codemodeValidateResult")
	encoded, err := ctx.Invoke(validator, global, result)
	if err != nil {
		return nil, nil, nil, err
	}

	var outcome validationOutcome
	if err := json.Unmarshal([]byte(encoded.String()), &outcome); err != nil {
		return nil, nil, nil, err
	}
	if len(outcome.Warnings) == 0 {
		outcome.Warnings = nil
	}
	if !outcome.OK {
		message := "JSON serialization failed after sanitization"
		if outcome.Error != "" {
			message = message + ": " + outcome.Error
		}
		return nil, outcome.Warnings, &ErrorEnvelope{Name: "NotSerializable", Message: message, Stack: ""}, nil
	}
	if len(outcome.JSON) > maxOutputBytes {
		return nil, outcome.Warnings, &ErrorEnvelope{
			Name:    "OutputTooLarge",
			Message: fmt.Sprintf("encoded result size %d bytes exceeds limit %d bytes", len(outcome.JSON), maxOutputBytes),
			Stack:   "",
		}, nil
	}
	return json.RawMessage(outcome.JSON), outcome.Warnings, nil, nil
}
