package sandbox

import (
	_ "embed"
	"strings"
)

//go:embed sandbox_preamble.js
var preambleTemplate string

const (
	spliceComment     = "// Splice point: Execute.WrappedJS is already harness-wrapped and transpiled."
	agentMainSpliceID = "__AGENT_MAIN_SPLICE__"
)

func buildPreamble(wrappedJS string) string {
	return strings.Replace(preambleTemplate, agentMainSpliceID, wrappedJS, 1)
}

func userCodeStartLine(program string) int {
	lines := strings.Split(program, "\n")
	for i, line := range lines {
		if line == spliceComment {
			return i + 2
		}
	}
	return 1
}
