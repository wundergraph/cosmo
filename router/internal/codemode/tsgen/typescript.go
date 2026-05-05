package tsgen

import (
	"strconv"
	"strings"
)

type tsProperty struct {
	name     string
	typ      string
	optional bool
}

func writeJSDoc(description string) string {
	clean := strings.Join(strings.Fields(description), " ")
	clean = strings.ReplaceAll(clean, "*/", "* /")
	if clean == "" {
		clean = "Registered GraphQL operation."
	}
	return "/** " + clean + " */"
}

func writeFieldSignature(description, name, varsType, outputType string, varsOptional bool) string {
	var b strings.Builder
	b.WriteString(writeJSDoc(description))
	b.WriteByte('\n')
	b.WriteString(name)
	if varsType == "{}" {
		b.WriteString("()")
	} else {
		b.WriteString("(vars")
		if varsOptional {
			b.WriteByte('?')
		}
		b.WriteString(": ")
		b.WriteString(varsType)
		b.WriteByte(')')
	}
	b.WriteString(": R<")
	b.WriteString(outputType)
	b.WriteString(">;")
	return b.String()
}

func writeInlineObject(fields []tsProperty) string {
	if len(fields) == 0 {
		return "{}"
	}

	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		suffix := ": "
		if field.optional {
			suffix = "?: "
		}
		parts = append(parts, field.name+suffix+field.typ)
	}

	return "{ " + strings.Join(parts, "; ") + " }"
}

func writeArray(item string) string {
	if strings.Contains(item, " | ") {
		item = "(" + item + ")"
	}
	return item + "[]"
}

func writeNullable(typ string) string {
	if strings.HasSuffix(typ, " | null") {
		return typ
	}
	return typ + " | null"
}

func writeStringLiteralUnion(values []string) string {
	if len(values) == 0 {
		return "unknown"
	}

	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, strconv.Quote(value))
	}

	return strings.Join(quoted, " | ")
}

func indentBlock(block, indent string) string {
	if block == "" {
		return ""
	}

	lines := strings.Split(block, "\n")
	for i := range lines {
		if lines[i] != "" {
			lines[i] = indent + lines[i]
		}
	}

	return strings.Join(lines, "\n")
}
