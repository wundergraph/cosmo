package mcpserver

import (
	"bytes"
	"fmt"
	"regexp"
	"unicode/utf8"

	"github.com/goccy/go-yaml"
)

// skillNameRegex enforces the Agent Skills spec name constraints:
// lowercase alphanumerics and single hyphens, no leading or trailing hyphen.
// See https://agentskills.io/specification.
var skillNameRegex = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

const (
	maxSkillNameLength        = 64
	maxSkillDescriptionLength = 1024
)

// contextFrontmatter holds the YAML frontmatter fields used for MCP resource
// metadata. Skills require Name and Description (Agent Skills spec); loose
// context documents use Title and Description opportunistically.
type contextFrontmatter struct {
	Name        string `yaml:"name"`
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
}

var (
	frontmatterFence = []byte("---")
	frontmatterLF    = []byte("\n---")
)

// parseContextFrontmatter extracts a leading YAML frontmatter block delimited
// by "---" lines. found reports whether a complete block exists; err is
// non-nil when a found block fails to parse. Callers treat absent and
// malformed differently: a skill without valid frontmatter is invalid, a
// loose document with malformed frontmatter is served without metadata.
func parseContextFrontmatter(content []byte) (fm contextFrontmatter, found bool, err error) {
	rest, ok := bytes.CutPrefix(content, frontmatterFence)
	if !ok {
		return fm, false, nil
	}
	// The opening fence must be its own line.
	rest = bytes.TrimPrefix(rest, []byte("\r"))
	rest, ok = bytes.CutPrefix(rest, []byte("\n"))
	if !ok {
		return fm, false, nil
	}

	end := bytes.Index(rest, frontmatterLF)
	if end < 0 {
		return fm, false, nil
	}

	if err := yaml.Unmarshal(rest[:end], &fm); err != nil {
		return contextFrontmatter{}, true, err
	}
	return fm, true, nil
}

// validateSkillMetadata checks a skill's frontmatter against the Agent Skills
// spec requirements. dirName is the basename of the skill directory.
func validateSkillMetadata(dirName string, fm contextFrontmatter, hasFrontmatter bool) error {
	if !hasFrontmatter {
		return fmt.Errorf("SKILL.md has no frontmatter block")
	}
	if fm.Name == "" {
		return fmt.Errorf("frontmatter field 'name' is required")
	}
	if utf8.RuneCountInString(fm.Name) > maxSkillNameLength {
		return fmt.Errorf("skill name exceeds %d characters", maxSkillNameLength)
	}
	if !skillNameRegex.MatchString(fm.Name) {
		return fmt.Errorf("skill name %q must be lowercase alphanumerics separated by single hyphens", fm.Name)
	}
	if fm.Name != dirName {
		return fmt.Errorf("skill name %q must match the directory name %q", fm.Name, dirName)
	}
	if fm.Description == "" {
		return fmt.Errorf("frontmatter field 'description' is required")
	}
	if utf8.RuneCountInString(fm.Description) > maxSkillDescriptionLength {
		return fmt.Errorf("skill description exceeds %d characters", maxSkillDescriptionLength)
	}
	return nil
}
