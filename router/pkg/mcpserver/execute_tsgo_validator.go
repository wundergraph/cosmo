package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"go.uber.org/zap"
)

var asyncArrowRootPattern = regexp.MustCompile(`(?s)^\s*\(?\s*async\s*\(\s*\)\s*=>`)

type executeTSValidator struct {
	command string
	args    []string
}

func newTypeScriptExecuteValidator(logger *zap.Logger) func(ctx context.Context, code string) error {
	if _, err := exec.LookPath("tsgo"); err == nil {
		validator := executeTSValidator{command: "tsgo"}
		return validator.Validate
	}
	if _, err := exec.LookPath("npx"); err == nil {
		validator := executeTSValidator{
			command: "npx",
			args:    []string{"-y", "@typescript/native-preview"},
		}
		return validator.Validate
	}

	if logger != nil {
		logger.Warn("TypeScript execute validation disabled: neither tsgo nor npx was found on PATH")
	}
	return nil
}

func (v executeTSValidator) Validate(ctx context.Context, code string) error {
	if !asyncArrowRootPattern.MatchString(code) {
		return errors.New("code must be rooted at an async arrow function with the form async () => { ... }")
	}

	tempDir, err := os.MkdirTemp("", "code-mode-tsgo-*")
	if err != nil {
		return fmt.Errorf("failed to create tsgo temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tempDir) }()

	if err := os.WriteFile(filepath.Join(tempDir, "validate.ts"), []byte(buildExecuteValidationSource(code)), 0o600); err != nil {
		return fmt.Errorf("failed to write tsgo validation source: %w", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "tsconfig.json"), []byte(executeValidationTSConfig), 0o600); err != nil {
		return fmt.Errorf("failed to write tsgo tsconfig: %w", err)
	}

	args := append(append([]string{}, v.args...), "--pretty", "false", "-p", "tsconfig.json")
	cmd := exec.CommandContext(ctx, v.command, args...)
	cmd.Dir = tempDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		text := strings.TrimSpace(string(output))
		if text == "" {
			return fmt.Errorf("tsgo validation failed: %w", err)
		}
		return fmt.Errorf("tsgo validation failed: %s", text)
	}

	return nil
}

func buildExecuteValidationSource(code string) string {
	return fmt.Sprintf(`type JSONPrimitive = null | boolean | number | string;
type JSONValue = JSONPrimitive | { [key: string]: JSONValue } | JSONValue[];

interface GraphQLError {
  message: string;
  path: (string | number)[] | null;
  extensions: Record<string, any> | null;
}

interface GraphQLResponse {
  data: any | null;
  errors: GraphQLError[] | null;
  declined?: { reason: string | null };
}

declare function executeOperationByHash(hash: string, variables?: Record<string, any>): Promise<GraphQLResponse>;

type ExecuteFn = () => Promise<JSONValue>;

const __executeGraphQL: ExecuteFn = %s;
void __executeGraphQL;
`, code)
}

const executeValidationTSConfig = `{
  "compilerOptions": {
    "target": "es2020",
    "module": "esnext",
    "lib": ["es2020"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "files": ["validate.ts"]
}
`
