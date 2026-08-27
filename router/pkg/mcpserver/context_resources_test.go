package mcpserver

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestParseContextFrontmatter(t *testing.T) {
	t.Run("parses name, title and description", func(t *testing.T) {
		fm, found, err := parseContextFrontmatter([]byte("---\nname: trip-planning\ntitle: Trip Planning\ndescription: Plan trips.\n---\n# Body\n"))
		require.True(t, found)
		require.NoError(t, err)
		assert.Equal(t, "trip-planning", fm.Name)
		assert.Equal(t, "Trip Planning", fm.Title)
		assert.Equal(t, "Plan trips.", fm.Description)
	})

	t.Run("no frontmatter block", func(t *testing.T) {
		_, found, err := parseContextFrontmatter([]byte("# Just markdown\n"))
		assert.False(t, found)
		assert.NoError(t, err)
	})

	t.Run("unterminated frontmatter is treated as absent", func(t *testing.T) {
		_, found, err := parseContextFrontmatter([]byte("---\nname: x\nno closing fence"))
		assert.False(t, found)
		assert.NoError(t, err)
	})

	t.Run("invalid yaml is found but errors", func(t *testing.T) {
		_, found, err := parseContextFrontmatter([]byte("---\n:{not yaml\n---\nbody"))
		assert.True(t, found)
		assert.Error(t, err)
	})

	t.Run("crlf line endings", func(t *testing.T) {
		fm, found, err := parseContextFrontmatter([]byte("---\r\nname: crlf-skill\r\ndescription: d\r\n---\r\nbody"))
		require.True(t, found)
		require.NoError(t, err)
		assert.Equal(t, "crlf-skill", fm.Name)
	})

	t.Run("optional agent skills keys are accepted and ignored", func(t *testing.T) {
		fm, found, err := parseContextFrontmatter([]byte("---\nname: a\ndescription: d\nlicense: MIT\ncompatibility: Requires nothing\nallowed-tools: Read\nmetadata:\n  author: x\n---\n"))
		require.True(t, found)
		require.NoError(t, err)
		assert.Equal(t, "a", fm.Name)
	})
}

func TestValidateSkillMetadata(t *testing.T) {
	valid := contextFrontmatter{Name: "trip-planning", Description: "Plan trips."}

	t.Run("valid", func(t *testing.T) {
		assert.NoError(t, validateSkillMetadata("trip-planning", valid, true))
	})

	t.Run("missing frontmatter", func(t *testing.T) {
		assert.Error(t, validateSkillMetadata("trip-planning", contextFrontmatter{}, false))
	})

	t.Run("name does not match directory", func(t *testing.T) {
		assert.Error(t, validateSkillMetadata("other-dir", valid, true))
	})

	t.Run("empty description", func(t *testing.T) {
		fm := contextFrontmatter{Name: "trip-planning"}
		assert.Error(t, validateSkillMetadata("trip-planning", fm, true))
	})

	t.Run("description too long", func(t *testing.T) {
		fm := contextFrontmatter{Name: "trip-planning", Description: strings.Repeat("x", 1025)}
		assert.Error(t, validateSkillMetadata("trip-planning", fm, true))
	})

	t.Run("invalid names", func(t *testing.T) {
		for _, name := range []string{"Trip-Planning", "-trip", "trip-", "trip--planning", "trip_planning", "", strings.Repeat("a", 65)} {
			fm := contextFrontmatter{Name: name, Description: "d"}
			assert.Error(t, validateSkillMetadata(name, fm, true), "name %q must be rejected", name)
		}
	})
}

// writeContextFiles writes files into dir, creating parent directories.
// Keys are slash-separated relative paths.
func writeContextFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for rel, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755))
		require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
	}
}

const validSkillMD = "---\nname: trip-planning\ndescription: Shows how to combine forecast and alert tools.\n---\n# Trip planning\n"

func TestContextURIBuilders(t *testing.T) {
	assert.Equal(t, "context:///notes.md", contextDocumentURI("notes.md"))
	assert.Equal(t, "context:///weather/usage.md", contextDocumentURI("weather/usage.md"))
	assert.Equal(t, "context:///a%20b/100%25.md", contextDocumentURI("a b/100%.md"))
	// Single-segment skill-path: no organizational prefix.
	assert.Equal(t, "skill://trip-planning/SKILL.md", skillFileURI("trip-planning", "SKILL.md"))
	assert.Equal(t, "skill://trip-planning/assets/a%20b.md", skillFileURI("trip-planning", "assets/a b.md"))
	// Multi-segment skill-path: SEP-2640 organizational prefix, every segment encoded.
	assert.Equal(t, "skill://acme/billing/refunds/SKILL.md", skillFileURI("acme/billing/refunds", "SKILL.md"))
}

func TestScanContextResources(t *testing.T) {
	logger := zap.NewNop()

	t.Run("loose markdown becomes context resource", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"notes.md":            "---\ntitle: Notes\ndescription: Team notes.\n---\nbody",
			"weather/usage.md":    "# Usage\n",
			"GetForecast.graphql": "query GetForecast { __typename }",
			"data.json":           "{}",
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		require.Empty(t, scan.skills)
		require.Len(t, scan.resources, 2)

		notes := scan.byURI["context:///notes.md"]
		assert.Equal(t, "notes.md", notes.name)
		assert.Equal(t, "Notes", notes.title)
		assert.Equal(t, "Team notes.", notes.description)
		assert.Equal(t, "text/markdown", notes.mimeType)
		assert.Empty(t, notes.skillName)

		usage := scan.byURI["context:///weather/usage.md"]
		assert.Equal(t, "weather/usage.md", usage.name)
		assert.Empty(t, usage.title)
	})

	t.Run("filenames are percent-encoded in URIs", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"my notes.md": "# Notes\n",
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		require.Len(t, scan.resources, 1)
		assert.Contains(t, scan.byURI, "context:///my%20notes.md")
	})

	t.Run("malformed loose frontmatter warns and serves bare", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"broken.md": "---\n:{not yaml\n---\nbody",
		})

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		require.Len(t, scan.resources, 1)
		res := scan.byURI["context:///broken.md"]
		assert.Empty(t, res.title)
		assert.Empty(t, res.description)
		assert.Equal(t, 1, logs.FilterMessage("Malformed frontmatter in context document").Len())
	})

	t.Run("symlinks and irregular files are skipped", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"real.md": "# Real\n",
		})
		require.NoError(t, os.Symlink(filepath.Join(dir, "real.md"), filepath.Join(dir, "link.md")))

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		require.Len(t, scan.resources, 1)
		assert.Contains(t, scan.byURI, "context:///real.md")
	})

	t.Run("oversized loose file is skipped", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		big := make([]byte, maxServedFileBytes+1)
		require.NoError(t, os.WriteFile(filepath.Join(dir, "big.md"), big, 0o644))

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.resources)
		assert.Equal(t, 1, logs.FilterMessage("Skipping oversized context file").Len())
	})

	t.Run("skill directory serves every file under skill scheme with path prefix", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"weather/trip-planning/SKILL.md":        validSkillMD,
			"weather/trip-planning/examples.md":     "# Examples\n",
			"weather/trip-planning/assets/data.csv": "a,b\n",
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		require.Len(t, scan.skills, 1)
		assert.Equal(t, "trip-planning", scan.skills[0].name)
		assert.Equal(t, "Shows how to combine forecast and alert tools.", scan.skills[0].description)
		// SEP-2640: the skill-path is the relative directory path; "weather"
		// is the organizational prefix, the final segment is the name.
		assert.Equal(t, "skill://weather/trip-planning/SKILL.md", scan.skills[0].uri)

		require.Len(t, scan.resources, 3)
		skillMD := scan.byURI["skill://weather/trip-planning/SKILL.md"]
		assert.Equal(t, "trip-planning", skillMD.name)
		assert.Equal(t, "trip-planning", skillMD.skillName)
		assert.Equal(t, "Shows how to combine forecast and alert tools.", skillMD.description)

		assert.Contains(t, scan.byURI, "skill://weather/trip-planning/examples.md")
		assert.Contains(t, scan.byURI, "skill://weather/trip-planning/assets/data.csv")
	})

	t.Run("skill at operations root has no prefix", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"trip-planning/SKILL.md": validSkillMD,
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		require.Len(t, scan.skills, 1)
		assert.Equal(t, "skill://trip-planning/SKILL.md", scan.skills[0].uri)
	})

	t.Run("operations root itself is never a skill", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"SKILL.md": validSkillMD,
			"notes.md": "# notes\n",
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		// The stray root SKILL.md is just a loose markdown document.
		assert.Contains(t, scan.byURI, "context:///SKILL.md")
		assert.Contains(t, scan.byURI, "context:///notes.md")
	})

	t.Run("invalid skill directory is skipped entirely", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"bad/SKILL.md": "---\nname: mismatch\ndescription: d\n---\n",
			"bad/notes.md": "# inside invalid skill\n",
			"good.md":      "# loose doc\n",
		})

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		require.Len(t, scan.resources, 1)
		assert.Contains(t, scan.byURI, "context:///good.md")
		assert.Equal(t, 1, logs.FilterMessage("Skipping invalid MCP skill directory").Len())
	})

	t.Run("same-named skills at different paths both serve with distinct URIs", func(t *testing.T) {
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"a/trip-planning/SKILL.md":  validSkillMD,
			"a/trip-planning/first.md":  "# from a\n",
			"b/trip-planning/SKILL.md":  validSkillMD,
			"b/trip-planning/second.md": "# from b\n",
		})

		scan, err := scanContextResources(dir, logger)
		require.NoError(t, err)
		// SEP-2640: name is a label, not an identifier; the path-prefixed URI
		// is the identity, so no collision handling is needed.
		require.Len(t, scan.skills, 2)
		assert.Contains(t, scan.byURI, "skill://a/trip-planning/first.md")
		assert.Contains(t, scan.byURI, "skill://b/trip-planning/second.md")
	})

	t.Run("skill exceeding file count limit is invalid", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		files := map[string]string{"crowded/SKILL.md": "---\nname: crowded\ndescription: d\n---\n"}
		for i := 0; i < maxSkillFiles; i++ { // SKILL.md + maxSkillFiles exceeds the limit
			files[fmt.Sprintf("crowded/f%04d.md", i)] = "x"
		}
		writeContextFiles(t, dir, files)

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		assert.Empty(t, scan.resources)
		assert.Equal(t, 1, logs.FilterMessage("Skipping MCP skill exceeding size limits").Len())
	})

	t.Run("skill exceeding total byte limit is invalid", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"heavy/SKILL.md": "---\nname: heavy\ndescription: d\n---\n",
		})
		big := make([]byte, maxSkillTotalBytes+1)
		require.NoError(t, os.WriteFile(filepath.Join(dir, "heavy", "big.bin"), big, 0o644))

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		assert.Empty(t, scan.resources)
		assert.Equal(t, 1, logs.FilterMessage("Skipping MCP skill exceeding size limits").Len())
	})

	t.Run("nested SKILL.md is served as supporting content of the enclosing skill", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"trip-planning/SKILL.md":        validSkillMD,
			"trip-planning/nested/SKILL.md": "---\nname: nested\ndescription: d\n---\n",
		})

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		// SEP-2640 permits nested skills; from the enclosing skill's
		// perspective the nested SKILL.md is ordinary supporting content.
		require.Len(t, scan.skills, 1)
		assert.Contains(t, scan.byURI, "skill://trip-planning/nested/SKILL.md")
		assert.Equal(t, 1, logs.FilterMessage("Nested SKILL.md served as supporting content of the enclosing skill").Len())
	})

	t.Run("skill under an invalid prefix directory is skipped", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		writeContextFiles(t, dir, map[string]string{
			"my team/refunds/SKILL.md": "---\nname: refunds\ndescription: Handle refunds.\n---\n# Refunds\n",
		})

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		assert.Empty(t, scan.resources)
		assert.Equal(t, 1, logs.FilterMessage("Skipping MCP skill with invalid URI").Len())
	})

	t.Run("skill with a symlinked SKILL.md is skipped", func(t *testing.T) {
		core, logs := observer.New(zapcore.DebugLevel)
		dir := t.TempDir()
		outsideDir := t.TempDir()
		realFile := filepath.Join(outsideDir, "real-skill.md")
		require.NoError(t, os.WriteFile(realFile, []byte("---\nname: refunds\ndescription: Handle refunds.\n---\n# Refunds\n"), 0o644))

		skillDir := filepath.Join(dir, "refunds")
		require.NoError(t, os.MkdirAll(skillDir, 0o755))
		require.NoError(t, os.Symlink(realFile, filepath.Join(skillDir, "SKILL.md")))

		scan, err := scanContextResources(dir, zap.New(core))
		require.NoError(t, err)
		assert.Empty(t, scan.skills)
		assert.Empty(t, scan.resources)
		assert.Equal(t, 1, logs.FilterMessage("Skipping MCP skill without a regular SKILL.md file").Len())
	})

	t.Run("missing directory returns error", func(t *testing.T) {
		_, err := scanContextResources(filepath.Join(t.TempDir(), "missing"), logger)
		assert.Error(t, err)
	})
}

func TestContextMIMEType(t *testing.T) {
	assert.Equal(t, "text/markdown", contextMIMEType("a/b.md"))
	assert.Equal(t, "text/markdown", contextMIMEType("a/B.MD"))
	assert.Equal(t, "text/plain", contextMIMEType("a.txt"))
	assert.Equal(t, "application/json", contextMIMEType("a.json"))
	assert.Equal(t, "application/yaml", contextMIMEType("a.yaml"))
	assert.Equal(t, "application/octet-stream", contextMIMEType("a.unknownext"))
}
