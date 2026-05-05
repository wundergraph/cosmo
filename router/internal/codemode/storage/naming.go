package storage

import (
	"slices"
	"strconv"
	"strings"
	"unicode"
)

var reservedWords = map[string]struct{}{
	"abstract":    {},
	"any":         {},
	"as":          {},
	"async":       {},
	"await":       {},
	"boolean":     {},
	"break":       {},
	"case":        {},
	"catch":       {},
	"class":       {},
	"const":       {},
	"constructor": {},
	"continue":    {},
	"debugger":    {},
	"declare":     {},
	"default":     {},
	"delete":      {},
	"do":          {},
	"else":        {},
	"enum":        {},
	"export":      {},
	"extends":     {},
	"false":       {},
	"finally":     {},
	"for":         {},
	"from":        {},
	"function":    {},
	"get":         {},
	"if":          {},
	"implements":  {},
	"import":      {},
	"in":          {},
	"infer":       {},
	"instanceof":  {},
	"interface":   {},
	"is":          {},
	"keyof":       {},
	"let":         {},
	"module":      {},
	"namespace":   {},
	"never":       {},
	"new":         {},
	"null":        {},
	"number":      {},
	"object":      {},
	"of":          {},
	"package":     {},
	"private":     {},
	"protected":   {},
	"public":      {},
	"readonly":    {},
	"require":     {},
	"return":      {},
	"satisfies":   {},
	"set":         {},
	"static":      {},
	"string":      {},
	"super":       {},
	"switch":      {},
	"symbol":      {},
	"this":        {},
	"throw":       {},
	"true":        {},
	"try":         {},
	"type":        {},
	"typeof":      {},
	"undefined":   {},
	"unique":      {},
	"unknown":     {},
	"var":         {},
	"void":        {},
	"while":       {},
	"with":        {},
	"yield":       {},
}

func NormalizeName(raw string) string {
	// Idempotency: names produced by an earlier NormalizeName call (carrying our reserved-word
	// or leading-digit prefixes) round-trip without re-splitting.
	if rest, ok := strings.CutPrefix(raw, "op_"); ok {
		if _, reserved := reservedWords[rest]; reserved && isLowerCamel(rest) {
			return raw
		}
	}
	if rest, ok := strings.CutPrefix(raw, "_"); ok {
		if len(rest) > 0 && unicode.IsDigit(rune(rest[0])) && isIdentTail(rest) {
			return raw
		}
	}
	words := strings.FieldsFunc(raw, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	words = slices.DeleteFunc(words, func(word string) bool {
		return word == ""
	})
	if len(words) == 0 {
		return "operation"
	}

	var builder strings.Builder
	for i, word := range words {
		if i == 0 {
			builder.WriteString(lowerFirst(word))
			continue
		}
		builder.WriteString(upperFirst(word))
	}

	name := builder.String()
	if name == "" {
		name = "operation"
	}
	if first, _ := firstRune(name); unicode.IsDigit(first) {
		name = "_" + name
	}
	if _, ok := reservedWords[name]; ok {
		name = "op_" + name
	}
	return name
}

func SuffixedName(base string, taken map[string]struct{}) string {
	if _, ok := taken[base]; !ok {
		return base
	}
	for i := 2; ; i++ {
		name := base + "_" + strconv.Itoa(i)
		if _, ok := taken[name]; !ok {
			return name
		}
	}
}

func lowerFirst(value string) string {
	if value == "" {
		return value
	}
	runes := []rune(value)
	runes[0] = unicode.ToLower(runes[0])
	return string(runes)
}

func upperFirst(value string) string {
	if value == "" {
		return value
	}
	runes := []rune(strings.ToLower(value))
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func isLowerCamel(value string) bool {
	if value == "" {
		return false
	}
	for i, r := range value {
		if i == 0 && !unicode.IsLower(r) {
			return false
		}
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func isIdentTail(value string) bool {
	for _, r := range value {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func firstRune(value string) (rune, bool) {
	for _, r := range value {
		return r, true
	}
	return 0, false
}
