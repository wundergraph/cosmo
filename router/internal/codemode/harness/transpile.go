package harness

import (
	"errors"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

type TranspileResult struct {
	JS          string
	SourceMap   []byte
	Diagnostics []Diagnostic
}

type Diagnostic struct {
	Text   string
	Line   int
	Column int
	File   string
}

func Transpile(source string) (TranspileResult, error) {
	result := api.Transform(source, api.TransformOptions{
		Loader:        api.LoaderTS,
		Target:        api.ES2020,
		Platform:      api.PlatformNeutral,
		Format:        api.FormatDefault,
		Sourcemap:     api.SourceMapExternal,
		Sourcefile:    "agent.ts",
		LogLevel:      api.LogLevelSilent,
		LegalComments: api.LegalCommentsNone,
		Drop:          api.DropDebugger,
		Charset:       api.CharsetASCII,
	})

	out := TranspileResult{
		JS:          trimTranspiledExpression(string(result.Code)),
		SourceMap:   append([]byte(nil), result.Map...),
		Diagnostics: diagnosticsFromMessages(result.Errors),
	}
	if len(result.Errors) > 0 {
		return out, errors.New("transpile failed: " + strings.Join(diagnosticTexts(out.Diagnostics), "; "))
	}
	return out, nil
}

func trimTranspiledExpression(js string) string {
	trimmed := strings.TrimSpace(js)
	return strings.TrimSuffix(trimmed, ";")
}

func diagnosticsFromMessages(messages []api.Message) []Diagnostic {
	diagnostics := make([]Diagnostic, 0, len(messages))
	for _, message := range messages {
		diagnostic := Diagnostic{Text: message.Text}
		if message.Location != nil {
			diagnostic.Line = message.Location.Line
			diagnostic.Column = message.Location.Column + 1
			diagnostic.File = message.Location.File
		}
		diagnostics = append(diagnostics, diagnostic)
	}
	return diagnostics
}

func diagnosticTexts(diagnostics []Diagnostic) []string {
	texts := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		texts = append(texts, diagnostic.Text)
	}
	return texts
}
