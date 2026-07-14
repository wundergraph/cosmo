package deferdemo

import (
	"os"
	"strings"
	"testing"
)

func TestRouterConfigurationEnablesDemoFeatures(t *testing.T) {
	contents, err := os.ReadFile("router.yaml")
	if err != nil {
		t.Fatalf("read router.yaml: %v", err)
	}

	config := string(contents)
	if !strings.Contains(config, "\nversion: \"1\"\n") {
		t.Error("router config must explicitly declare version 1")
	}

	engine := topLevelYAMLBlock(config, "engine:")
	if !strings.Contains(engine, "\n  enable_defer: true\n") {
		t.Error("router config must explicitly enable defer")
	}
	if !strings.Contains(engine, "\n  enable_request_tracing: true\n") {
		t.Error("router config must explicitly enable request tracing")
	}
}

func topLevelYAMLBlock(contents, header string) string {
	lines := strings.Split(contents, "\n")
	for i, line := range lines {
		if line != header {
			continue
		}

		end := i + 1
		for end < len(lines) && (lines[end] == "" || strings.HasPrefix(lines[end], " ")) {
			end++
		}
		return "\n" + strings.Join(lines[i:end], "\n") + "\n"
	}
	return ""
}
