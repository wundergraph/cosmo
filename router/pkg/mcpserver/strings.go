package mcpserver

import (
	"strings"
	"unicode"
)

// toSnakeCase converts a string to snake_case format
// It handles various input formats:
// - CamelCase -> camel_case
// - PascalCase -> pascal_case
// - Space-separated -> space_separated
// - Hyphen-separated -> hyphen_separated
// Acronyms like "URL" or "API" are preserved as lowercase without internal underscores
func toSnakeCase(s string) string {
	var result strings.Builder

	// Replace hyphens and spaces with underscores
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")

	// Handle acronyms and normal camel case
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		// Current character
		r := runes[i]

		// Add underscore if current character is uppercase and:
		// 1. Not at the beginning of the string, AND
		// 2. Previous character is lowercase, OR
		// 3. Next character exists and is lowercase (end of acronym)
		if i > 0 && unicode.IsUpper(r) {
			prevIsLower := unicode.IsLower(runes[i-1])
			nextIsLower := (i+1 < len(runes)) && unicode.IsLower(runes[i+1])

			// Add underscore if transitioning from lowercase to uppercase
			// or from uppercase sequence to lowercase (end of acronym)
			if prevIsLower || nextIsLower && i > 1 && unicode.IsUpper(runes[i-1]) {
				result.WriteRune('_')
			}
		}

		result.WriteRune(unicode.ToLower(r))
	}

	return result.String()
}
