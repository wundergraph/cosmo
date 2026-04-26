package tsgen

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// declareOpFunction is the function declaration the model uses to call
// persisted operations.
const declareOpFunction = `declare function op<H extends keyof Ops>(hash: H, vars: Ops[H]["vars"]): Promise<Ops[H]["data"]>;`

// declareOpRequireFunction is the strict-paths variant.
const declareOpRequireFunction = `declare function opRequire<H extends keyof Ops, P extends Path<Ops[H]["data"]>[]>(hash: H, vars: Ops[H]["vars"], required: P): Promise<Required<Ops[H]["data"], P>>;`

// pathPreambleSimple ships the lightweight Path/Required types described in
// §4.4.2: `Path<T>` is just `string` so paths are not statically validated;
// the runtime checks them.
const pathPreambleSimple = `type Path<T> = string;
type Required<T, P extends string[]> = T;`

// GenerateBundle emits a full `.d.ts` blob for the supplied operations.
// Returns the generated text, the registry of shared types referenced, and
// any error encountered.
//
// In DeliveryModeAppend, every schema enum and input object is pre-extracted
// at the top so future appends can reference them by name. In other modes,
// only types that are actually reused by ≥2 operations are extracted.
func GenerateBundle(ops []Operation, schema *ast.Document, cfg Config) (string, SharedTypes, error) {
	if schema == nil {
		return "", SharedTypes{}, errors.New("tsgen: schema is required")
	}

	var registry SharedTypes
	switch cfg.DeliveryMode {
	case DeliveryModeAppend:
		registry = schemaSharedTypes(schema, cfg)
	case DeliveryModePerOp:
		registry = SharedTypes{}
	default: // DeliveryModeBundle
		registry = extractReusedTypes(ops, schema, SharedTypes{}, cfg)
	}

	// In per-op mode, every entry is independent. The bundle is just the
	// concatenation of per-op JSON-like signatures. We don't typically use
	// GenerateBundle for per-op delivery — that's `GeneratePerOp`.
	var sb strings.Builder

	if cfg.BundleHeader {
		sb.WriteString(declareOpFunction)
		sb.WriteByte('\n')
		if cfg.StrictPathTypes {
			sb.WriteString(declareOpRequireFunction)
			sb.WriteByte('\n')
		} else {
			sb.WriteString(pathPreambleSimple)
			sb.WriteByte('\n')
		}
		sb.WriteByte('\n')
	}

	if len(registry.Aliases) > 0 {
		sb.WriteString("// Shared schema types\n")
		writeAliases(&sb, registry.Aliases)
		sb.WriteByte('\n')
	}

	sb.WriteString("interface Ops {\n")
	for _, op := range ops {
		entry, _, err := GenerateSignature(op, schema, registry, cfg)
		if err != nil {
			return "", SharedTypes{}, fmt.Errorf("tsgen: signature for %s: %w", op.Hash, err)
		}
		writeEntry(&sb, op, entry, cfg)
	}
	sb.WriteString("}\n")

	return sb.String(), registry, nil
}

// AppendChunk emits an append-mode chunk for newly persisted operations. The
// chunk references the already-known shared types by name and only introduces
// aliases for genuinely new types (e.g. enums added to the schema since the
// last delivery).
func AppendChunk(ops []Operation, schema *ast.Document, known SharedTypes, seq uint64, cfg Config) (string, SharedTypes, error) {
	return appendChunkImpl(ops, schema, known, seq, cfg, time.Now().UTC())
}

func appendChunkImpl(ops []Operation, schema *ast.Document, known SharedTypes, seq uint64, cfg Config, now time.Time) (string, SharedTypes, error) {
	if schema == nil {
		return "", SharedTypes{}, errors.New("tsgen: schema is required")
	}

	// Ensure no append entry collides with an already-delivered hash. The
	// caller should track delivered hashes; we cross-check via the SharedTypes
	// registry isn't sufficient. We expose this via an explicit delivered-hash
	// arg in a future iteration; for now, the caller's responsibility.

	// Determine extra shared types to introduce in this chunk: any type used
	// by ops that isn't already in `known`.
	extras := extractReusedTypes(ops, schema, known, cfg)
	// Newly introduced types are the difference.
	newlyIntroduced := SharedTypes{}
	for _, a := range extras.Aliases {
		if !known.Has(a.Name) {
			newlyIntroduced.Add(a)
		}
	}

	// Even if a type appears in only one op of the chunk but is already
	// known from an earlier delivery, we still want to reference it by name.
	// Build the full registry the entries can resolve against.
	full := known.clone()
	for _, a := range newlyIntroduced.Aliases {
		full.Add(a)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("// === persisted ops bundle (append #%d @ %s) ===\n",
		seq, now.Format(time.RFC3339)))
	if len(newlyIntroduced.Aliases) > 0 {
		writeAliases(&sb, newlyIntroduced.Aliases)
	}
	sb.WriteString("interface Ops {\n")
	for _, op := range ops {
		entry, _, err := GenerateSignature(op, schema, full, cfg)
		if err != nil {
			return "", SharedTypes{}, fmt.Errorf("tsgen: signature for %s: %w", op.Hash, err)
		}
		writeEntry(&sb, op, entry, cfg)
	}
	sb.WriteString("}\n")

	return sb.String(), newlyIntroduced, nil
}

// GeneratePerOp returns one fully-inlined TS rendering per operation, keyed by
// hash. Suitable for retrieval-style delivery (§4.2).
func GeneratePerOp(ops []Operation, schema *ast.Document, cfg Config) (map[string]string, error) {
	if schema == nil {
		return nil, errors.New("tsgen: schema is required")
	}
	out := make(map[string]string, len(ops))
	cfg.DeliveryMode = DeliveryModePerOp
	for _, op := range ops {
		entry, _, err := GenerateSignature(op, schema, SharedTypes{}, cfg)
		if err != nil {
			return nil, fmt.Errorf("tsgen: signature for %s: %w", op.Hash, err)
		}
		out[op.Hash] = entry
	}
	return out, nil
}

func writeAliases(sb *strings.Builder, aliases []SharedType) {
	for _, a := range aliases {
		sb.WriteString("type ")
		sb.WriteString(a.Name)
		sb.WriteString(" = ")
		sb.WriteString(a.TS)
		sb.WriteString(";\n")
	}
}

func writeEntry(sb *strings.Builder, op Operation, entry string, cfg Config) {
	sb.WriteString("  ")
	if cfg.EmitComments && op.Name != "" {
		sb.WriteString("// ")
		sb.WriteString(op.Name)
		sb.WriteString(" — ")
		sb.WriteString(op.Kind.Name())
		sb.WriteString("\n  ")
	}
	sb.WriteByte('"')
	sb.WriteString(op.Hash)
	sb.WriteString(`": `)
	sb.WriteString(entry)
	sb.WriteString(";\n")
}
