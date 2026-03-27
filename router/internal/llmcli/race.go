package llmcli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// TextRunner produces a plain-text response for a prompt.
type TextRunner interface {
	Name() string
	Run(ctx context.Context, prompt string) (string, error)
}

type runner struct {
	name string
	run  func(ctx context.Context, prompt string) (string, error)
}

func (r runner) Name() string {
	return r.name
}

func (r runner) Run(ctx context.Context, prompt string) (string, error) {
	return r.run(ctx, prompt)
}

// NewRunner creates an in-memory runner, useful for tests.
func NewRunner(name string, run func(ctx context.Context, prompt string) (string, error)) TextRunner {
	return runner{name: name, run: run}
}

// NewClaudeRunner returns a runner backed by the Claude CLI.
func NewClaudeRunner() TextRunner {
	return runner{name: "claude", run: runClaude}
}

// NewCodexRunner returns a runner backed by Codex CLI exec mode.
func NewCodexRunner() TextRunner {
	return runner{name: "codex", run: runCodex}
}

// FirstDecoded runs all runners in parallel, returning the first response that
// the decoder accepts. Slower runners are canceled after the first success.
func FirstDecoded[T any](ctx context.Context, prompt string, decode func(name, text string) (T, error), runners ...TextRunner) (T, string, error) {
	var zero T
	if len(runners) == 0 {
		return zero, "", errors.New("no runners configured")
	}

	type result struct {
		name string
		text string
		err  error
	}

	resultCh := make(chan result, len(runners))
	cancels := make([]context.CancelFunc, 0, len(runners))
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()

	for _, r := range runners {
		runnerCtx, cancel := context.WithCancel(ctx)
		cancels = append(cancels, cancel)
		go func(r TextRunner) {
			text, err := r.Run(runnerCtx, prompt)
			resultCh <- result{name: r.Name(), text: text, err: err}
		}(r)
	}

	var errs []string
	for range runners {
		res := <-resultCh
		if res.err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", res.name, res.err))
			continue
		}
		value, err := decode(res.name, res.text)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", res.name, err))
			continue
		}
		for _, cancel := range cancels {
			cancel()
		}
		return value, res.name, nil
	}

	return zero, "", errors.New(strings.Join(errs, "; "))
}

// StripMarkdownCodeFences removes a single surrounding fenced code block when present.
func StripMarkdownCodeFences(text string) string {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "```") {
		return text
	}

	lines := strings.Split(text, "\n")
	if len(lines) < 2 {
		return strings.Trim(text, "`")
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		return text
	}

	end := len(lines)
	if strings.TrimSpace(lines[end-1]) == "```" {
		end--
	}
	if end <= 1 {
		return ""
	}
	return strings.TrimSpace(strings.Join(lines[1:end], "\n"))
}

func runClaude(ctx context.Context, prompt string) (string, error) {
	cmd := exec.CommandContext(ctx, "claude", "-p", prompt, "--output-format", "text", "--tools", "")
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("command failed: %w%s", err, formatExecOutput(stderr.String()))
	}

	return strings.TrimSpace(stdout.String()), nil
}

func runCodex(ctx context.Context, prompt string) (string, error) {
	outputFile, err := os.CreateTemp("", "codex-output-*.txt")
	if err != nil {
		return "", fmt.Errorf("failed to create temp output file: %w", err)
	}
	outputPath := outputFile.Name()
	_ = outputFile.Close()
	defer func() { _ = os.Remove(outputPath) }()

	cmd := exec.CommandContext(ctx,
		"codex", "exec",
		"--skip-git-repo-check",
		"--sandbox", "read-only",
		"-o", outputPath,
		"-",
	)
	cmd.Stdin = strings.NewReader(prompt)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		combined := strings.TrimSpace(strings.Join([]string{stdout.String(), stderr.String()}, "\n"))
		return "", fmt.Errorf("command failed: %w%s", err, formatExecOutput(combined))
	}

	output, err := os.ReadFile(outputPath)
	if err != nil {
		return "", fmt.Errorf("failed to read codex output: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

func formatExecOutput(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	return "\n" + output
}
