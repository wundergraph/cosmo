package mcpserver

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
