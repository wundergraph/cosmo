package llmcli

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFirstDecodedSkipsInvalidResponseAndReturnsNextValid(t *testing.T) {
	t.Parallel()

	fastInvalid := NewRunner("fast-invalid", func(ctx context.Context, prompt string) (string, error) {
		return "not-json", nil
	})
	slowValid := NewRunner("slow-valid", func(ctx context.Context, prompt string) (string, error) {
		select {
		case <-time.After(20 * time.Millisecond):
			return `{"ok":true}`, nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	})

	value, winner, err := FirstDecoded(context.Background(), "prompt", func(name, text string) (map[string]bool, error) {
		var decoded map[string]bool
		return decoded, json.Unmarshal([]byte(text), &decoded)
	}, fastInvalid, slowValid)
	require.NoError(t, err)
	assert.Equal(t, "slow-valid", winner)
	assert.Equal(t, map[string]bool{"ok": true}, value)
}

func TestFirstDecodedCancelsSlowerRunnerAfterSuccess(t *testing.T) {
	t.Parallel()

	canceled := make(chan struct{}, 1)
	fastValid := NewRunner("fast-valid", func(ctx context.Context, prompt string) (string, error) {
		return "winner", nil
	})
	slowRunner := NewRunner("slow-runner", func(ctx context.Context, prompt string) (string, error) {
		<-ctx.Done()
		canceled <- struct{}{}
		return "", ctx.Err()
	})

	value, winner, err := FirstDecoded(context.Background(), "prompt", func(name, text string) (string, error) {
		return text, nil
	}, fastValid, slowRunner)
	require.NoError(t, err)
	assert.Equal(t, "fast-valid", winner)
	assert.Equal(t, "winner", value)

	select {
	case <-canceled:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("slow runner was not canceled")
	}
}

func TestStripMarkdownCodeFences(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "async () => {\n  return 1;\n}", StripMarkdownCodeFences("```ts\nasync () => {\n  return 1;\n}\n```"))
	assert.Equal(t, "plain text", StripMarkdownCodeFences("plain text"))
}
