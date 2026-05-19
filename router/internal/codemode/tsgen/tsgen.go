package tsgen

import (
	"context"
	"fmt"
	"strings"

	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

const (
	defaultMaxBundleBytes = 64 * 1024
	graphQLErrorAlias     = "type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };"
	responseAlias         = "type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;"
	notNullHelper         = "declare function notNull<T>(value: T | null | undefined, message?: string): T;"
	compactHelper         = "declare function compact<T>(value: T): T;"
)

type Renderer struct {
	Schema   *ast.Document
	MaxBytes int
}

func Adapter(schema *ast.Document, maxBytes ...int) storage.Renderer {
	limit := defaultMaxBundleBytes
	if len(maxBytes) > 0 {
		limit = maxBytes[0]
	}

	return Renderer{Schema: schema, MaxBytes: limit}
}

func (r Renderer) Render(_ context.Context, ops []storage.SessionOp, schema *ast.Document) (string, error) {
	if schema == nil {
		schema = r.Schema
	}
	return RenderBundle(ops, schema, r.MaxBytes)
}

func NewOpsFragment(ops []storage.SessionOp, schema *ast.Document) (string, error) {
	renderer := operationRenderer{schema: schema}

	blocks := make([]string, 0, len(ops))
	for _, op := range ops {
		block, err := renderer.renderOperation(op)
		if err != nil {
			return "", err
		}
		blocks = append(blocks, block)
	}

	return strings.Join(blocks, "\n\n"), nil
}

func RenderBundle(ops []storage.SessionOp, schema *ast.Document, maxBytes int) (string, error) {
	renderer := operationRenderer{schema: schema}

	blocks := make([]string, 0, len(ops))
	for _, op := range ops {
		block, err := renderer.renderOperation(op)
		if err != nil {
			return "", err
		}
		blocks = append(blocks, block)
	}

	if maxBytes <= 0 {
		return renderBundleBlocks(blocks, 0), nil
	}

	full := renderBundleBlocks(blocks, 0)
	if len([]byte(full)) <= maxBytes {
		return full, nil
	}

	for omitted := 1; omitted <= len(blocks); omitted++ {
		candidate := renderBundleBlocks(blocks[:len(blocks)-omitted], omitted)
		if len([]byte(candidate)) <= maxBytes {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("render TypeScript bundle: maxBytes %d is too small for bundle prelude", maxBytes)
}

func renderBundleBlocks(blocks []string, omitted int) string {
	var b strings.Builder
	b.WriteString(graphQLErrorAlias)
	b.WriteByte('\n')
	b.WriteString(responseAlias)
	b.WriteString("\n\n")

	if len(blocks) == 0 {
		b.WriteString("declare const tools: {};")
	} else {
		b.WriteString("declare const tools: {\n")
		for i, block := range blocks {
			if i > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(indentBlock(block, "  "))
		}
		b.WriteString("\n};")
	}

	b.WriteString("\n\n")
	b.WriteString(notNullHelper)
	b.WriteByte('\n')
	b.WriteString(compactHelper)

	if omitted > 0 {
		fmt.Fprintf(&b, "\n// truncated: %d ops omitted", omitted)
	}

	return b.String()
}
