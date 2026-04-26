// Package tsgen generates compact TypeScript signatures for persisted GraphQL
// operations. The output is delivered to LLM agents so they can call persisted
// operations through a strongly-typed `op(hash, vars)` function.
//
// See rfc/persistedopstsspec.md for the design.
package tsgen

import (
	"errors"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// DeliveryMode controls how shared types are extracted across operations.
type DeliveryMode int

const (
	// DeliveryModeBundle extracts enums and input objects when reused (≥2 uses).
	DeliveryModeBundle DeliveryMode = iota
	// DeliveryModeAppend pre-extracts every schema enum and input object so that
	// subsequent append chunks can reference them by name without retroactive
	// rewrites.
	DeliveryModeAppend
	// DeliveryModePerOp inlines all shared types — every signature is fully
	// self-contained.
	DeliveryModePerOp
)

// Config controls signature generation.
type Config struct {
	// Scalars maps custom GraphQL scalar names to TypeScript types.
	Scalars map[string]string
	// Compact strips newlines within the body of each operation entry.
	Compact bool
	// EmitComments adds a single `// name — kind` line above each operation
	// entry.
	EmitComments bool
	// BundleHeader controls whether the bundle preamble (op declaration,
	// extracted shared types, etc.) is emitted.
	BundleHeader bool
	// DeliveryMode selects how shared types are extracted.
	DeliveryMode DeliveryMode
	// ExtractOutputShapes is a placeholder for the experimental Tier 3 policy
	// described in §3.8. Currently unused.
	ExtractOutputShapes bool
	// StrictPathTypes ships the full template-literal Path/Required types in
	// the bundle preamble. Off by default — the simple (`type Path<T> = string`)
	// version is used.
	StrictPathTypes bool
}

// SharedTypeKind classifies a shared TS type alias.
type SharedTypeKind int

const (
	// SharedTypeEnum is a `type X = "A"|"B"|"C"` alias.
	SharedTypeEnum SharedTypeKind = iota
	// SharedTypeInputObject is a `type X = { ... }` alias for a GraphQL input
	// object.
	SharedTypeInputObject
)

// SharedType is a single hoisted TypeScript type alias.
type SharedType struct {
	Name string
	TS   string
	Kind SharedTypeKind
}

// SharedTypes is an insertion-ordered registry of shared type aliases.
// Lookups are by name (linear scan) — the registry stays small.
type SharedTypes struct {
	Aliases []SharedType
}

// Has reports whether a shared type with the given name has been registered.
func (s *SharedTypes) Has(name string) bool {
	for i := range s.Aliases {
		if s.Aliases[i].Name == name {
			return true
		}
	}
	return false
}

// Add registers a shared type. Duplicates (by name) are ignored.
func (s *SharedTypes) Add(t SharedType) {
	if s.Has(t.Name) {
		return
	}
	s.Aliases = append(s.Aliases, t)
}

// Get returns the shared type with the given name, if any.
func (s *SharedTypes) Get(name string) (SharedType, bool) {
	for i := range s.Aliases {
		if s.Aliases[i].Name == name {
			return s.Aliases[i], true
		}
	}
	return SharedType{}, false
}

// clone returns a shallow copy of the registry.
func (s SharedTypes) clone() SharedTypes {
	if len(s.Aliases) == 0 {
		return SharedTypes{}
	}
	out := SharedTypes{Aliases: make([]SharedType, len(s.Aliases))}
	copy(out.Aliases, s.Aliases)
	return out
}

// Operation is a parsed, validated GraphQL operation paired with its hash.
// Doc holds only this operation (and any fragments it references); the
// supergraph schema is supplied separately as the `schema` argument.
type Operation struct {
	Hash  string
	Name  string
	Kind  ast.OperationType
	Doc   *ast.Document
	OpRef int
}

// ErrInvalidOperation is returned when an operation cannot be processed because
// of structural issues (missing schema types, invalid variable refs, etc.).
var ErrInvalidOperation = errors.New("tsgen: invalid operation")

// GenerateSignature emits one `Ops` entry value: `{ vars: {...}; data: {...} }`.
// `known` is the set of shared types already delivered to this session; the
// formatter references those types by name rather than re-inlining them.
// The returned `used` is the subset of `known` plus any newly-promoted aliases
// that the entry actually references.
func GenerateSignature(op Operation, schema *ast.Document, known SharedTypes, cfg Config) (entry string, used SharedTypes, err error) {
	if op.Doc == nil {
		return "", SharedTypes{}, ErrInvalidOperation
	}
	b := newSignatureBuilder(op, schema, known, cfg)
	return b.build()
}

// SignatureResult bundles the entry text, used shared types, and any required
// paths discovered during emission. Callers persisting an operation should
// store both the signature and the paths.
type SignatureResult struct {
	Entry         string
	Used          SharedTypes
	RequiredPaths []string
}

// GenerateSignatureWithPaths is like GenerateSignature but additionally returns
// the dotted paths that carry @require annotations in the operation. These
// should be persisted alongside the operation so the runtime can enforce them.
func GenerateSignatureWithPaths(op Operation, schema *ast.Document, known SharedTypes, cfg Config) (SignatureResult, error) {
	if op.Doc == nil {
		return SignatureResult{}, ErrInvalidOperation
	}
	b := newSignatureBuilder(op, schema, known, cfg)
	entry, used, err := b.build()
	if err != nil {
		return SignatureResult{}, err
	}
	return SignatureResult{
		Entry:         entry,
		Used:          used,
		RequiredPaths: b.RequiredPaths(),
	}, nil
}
