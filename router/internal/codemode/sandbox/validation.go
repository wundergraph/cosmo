package sandbox

import (
	"encoding/json"
	"fmt"
	"strings"

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
  const bad = [];
  const seen = new WeakSet();
  const keyPath = (base, key) => {
    if (typeof key === "number") return base + "[" + key + "]";
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? base + "." + key : base + "[" + JSON.stringify(key) + "]";
  };
  const walk = (v, path) => {
    const t = typeof v;
    if (t === "bigint" || t === "function" || t === "symbol" || t === "undefined") {
      bad.push(path);
      return;
    }
    if (v && t === "object") {
      if (seen.has(v)) {
        bad.push(path);
        return;
      }
      seen.add(v);
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i], keyPath(path, i));
        return;
      }
      for (const k of Object.keys(v)) walk(v[k], keyPath(path, k));
    }
  };
  walk(value, "$");
  if (bad.length) return JSON.stringify({ serializable: false, paths: bad });
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return JSON.stringify({ serializable: false, paths: ["$"] });
    return JSON.stringify({ serializable: true, json });
  } catch (err) {
    return JSON.stringify({ serializable: false, paths: ["$"] });
  }
};
`

type validationOutcome struct {
	Serializable bool     `json:"serializable"`
	JSON         string   `json:"json"`
	Paths        []string `json:"paths"`
}

func installValidationHelpers(ctx *qjs.Context) error {
	val, err := ctx.Eval("codemode_validation.js", qjs.Code(validationHelpers))
	_ = val
	return err
}

func validateResult(ctx *qjs.Context, result *qjs.Value, maxOutputBytes int) (json.RawMessage, *ErrorEnvelope, error) {
	global := ctx.Global()
	validator := global.GetPropertyStr("__codemodeValidateResult")
	encoded, err := ctx.Invoke(validator, global, result)
	if err != nil {
		return nil, nil, err
	}

	var outcome validationOutcome
	if err := json.Unmarshal([]byte(encoded.String()), &outcome); err != nil {
		return nil, nil, err
	}
	if !outcome.Serializable {
		message := "return value contains non-JSON-serializable values at " + strings.Join(outcome.Paths, ", ")
		return nil, &ErrorEnvelope{Name: "NotSerializable", Message: message, Stack: ""}, nil
	}
	if len(outcome.JSON) > maxOutputBytes {
		return nil, &ErrorEnvelope{
			Name:    "OutputTooLarge",
			Message: fmt.Sprintf("encoded result size %d bytes exceeds limit %d bytes", len(outcome.JSON), maxOutputBytes),
			Stack:   "",
		}, nil
	}
	return json.RawMessage(outcome.JSON), nil, nil
}
