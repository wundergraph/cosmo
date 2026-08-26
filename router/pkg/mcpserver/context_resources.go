package mcpserver

import (
	"bytes"
	"fmt"
	"io/fs"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/goccy/go-yaml"
	"go.uber.org/zap"
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

// contextResource is one file served over MCP resources. skillName is empty
// for loose context documents.
type contextResource struct {
	uri         string
	name        string
	title       string
	description string
	mimeType    string
	filePath    string
	skillName   string
}

// contextSkill is one valid Agent Skills directory found in the scan.
type contextSkill struct {
	name        string
	description string
	uri         string
}

// contextScan is the result of scanning the operations directory for context
// documents and skills. Client-supplied URIs are only ever looked up as map
// keys into byURI; the handler reads the filePath recorded at scan time, so
// path traversal is impossible by construction.
type contextScan struct {
	skills    []contextSkill
	resources []contextResource
	byURI     map[string]contextResource
}

func newEmptyContextScan() *contextScan {
	return &contextScan{byURI: map[string]contextResource{}}
}

func (c *contextScan) add(r contextResource) {
	c.resources = append(c.resources, r)
	c.byURI[r.uri] = r
}

// contextMIMEType maps a file path to the MIME type served in resource
// metadata and contents.
func contextMIMEType(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".md", ".markdown":
		return "text/markdown"
	case ".txt":
		return "text/plain"
	case ".json":
		return "application/json"
	case ".yaml", ".yml":
		return "application/yaml"
	default:
		if t := mime.TypeByExtension(filepath.Ext(p)); t != "" {
			return t
		}
		return "application/octet-stream"
	}
}

const skillFileName = "SKILL.md"

// Size limits adopted from the SEP-2640 draft (512 resources per skill,
// 16 MiB total skill content). maxServedFileBytes also bounds per-request
// memory: resources/read loads the whole file.
const (
	maxSkillFiles      = 512
	maxSkillTotalBytes = int64(16 << 20)
	maxServedFileBytes = int64(16 << 20)
)

// contextDocumentURI builds context:///<encoded-path> for a loose document.
// The empty authority (triple slash) keeps the URI RFC 3986 compliant:
// context://weather/usage.md would make "weather" a host.
func contextDocumentURI(relSlashPath string) string {
	u := url.URL{Scheme: "context", Path: "/" + relSlashPath}
	return u.String()
}

// skillFileURI builds skill://<skill-path>/<encoded-file-path> (SEP-2640
// shape). skillPath is the skill directory's slash-separated path relative
// to the operations root: the final segment is the skill name, preceding
// segments are an organizational prefix, and the first segment occupies the
// URI authority position with no special semantics. Each segment is
// percent-encoded so the authority stays a valid RFC 3986 reg-name.
func skillFileURI(skillPath, relSlashPath string) string {
	encode := func(p string) string {
		segs := strings.Split(p, "/")
		for i, s := range segs {
			segs[i] = url.PathEscape(s)
		}
		return strings.Join(segs, "/")
	}
	return "skill://" + encode(skillPath) + "/" + encode(relSlashPath)
}

// scanContextResources walks dir in lexical order and collects loose markdown
// documents and Agent Skills directories to serve as MCP resources. Invalid
// skills are logged and skipped in full; the scan continues. Only regular
// files are served; symlinks and special files are ignored.
func scanContextResources(dir string, logger *zap.Logger) (*contextScan, error) {
	scan := newEmptyContextScan()

	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() {
			// The operations root is the server's namespace, never a skill;
			// a stray root SKILL.md is served as a loose document.
			if p == dir {
				return nil
			}
			if _, statErr := os.Stat(filepath.Join(p, skillFileName)); statErr != nil {
				return nil // not a skill directory, keep walking
			}
			collectSkillDirectory(scan, dir, p, logger)
			return fs.SkipDir // the skill subtree was fully handled above
		}

		if !d.Type().IsRegular() {
			logger.Debug("Skipping irregular file in MCP context scan", zap.String("file", p))
			return nil
		}

		// Loose files: only markdown becomes a context document.
		if ext := strings.ToLower(filepath.Ext(p)); ext != ".md" && ext != ".markdown" {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return infoErr
		}
		if info.Size() > maxServedFileBytes {
			logger.Warn("Skipping oversized context file",
				zap.String("file", p), zap.Int64("size", info.Size()))
			return nil
		}

		rel, relErr := filepath.Rel(dir, p)
		if relErr != nil {
			return relErr
		}
		relSlash := filepath.ToSlash(rel)
		res := contextResource{
			uri:      contextDocumentURI(relSlash),
			name:     relSlash,
			mimeType: contextMIMEType(p),
			filePath: p,
		}
		if content, readErr := os.ReadFile(p); readErr == nil {
			fm, found, fmErr := parseContextFrontmatter(content)
			switch {
			case fmErr != nil:
				logger.Warn("Malformed frontmatter in context document",
					zap.String("file", p), zap.Error(fmErr))
			case found:
				res.title = fm.Title
				res.description = fm.Description
			}
		}
		scan.add(res)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scan, nil
}

// collectSkillDirectory validates the skill rooted at root and, when valid,
// adds the skill and every regular file inside it to scan. Any violation
// (bad frontmatter, size limits) invalidates the whole skill: none of its
// files are served. The skill-path is root's path relative to scanDir
// (SEP-2640 organizational prefix + name), so same-named skills at
// different paths never collide.
func collectSkillDirectory(scan *contextScan, scanDir, root string, logger *zap.Logger) {
	content, err := os.ReadFile(filepath.Join(root, skillFileName))
	if err != nil {
		logger.Error("Skipping invalid MCP skill directory", zap.String("dir", root), zap.Error(err))
		return
	}
	fm, found, fmErr := parseContextFrontmatter(content)
	if vErr := validateSkillMetadata(filepath.Base(root), fm, found && fmErr == nil); vErr != nil {
		logger.Error("Skipping invalid MCP skill directory", zap.String("dir", root), zap.Error(vErr))
		return
	}

	relRoot, err := filepath.Rel(scanDir, root)
	if err != nil {
		logger.Error("Skipping invalid MCP skill directory", zap.String("dir", root), zap.Error(err))
		return
	}
	skillPath := filepath.ToSlash(relRoot)

	var (
		files      []contextResource
		totalBytes int64
	)
	walkErr := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			logger.Debug("Skipping irregular file in MCP skill", zap.String("file", p))
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return infoErr
		}
		totalBytes += info.Size()

		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return relErr
		}
		relSlash := filepath.ToSlash(rel)
		res := contextResource{
			uri:       skillFileURI(skillPath, relSlash),
			name:      fm.Name + "/" + relSlash,
			mimeType:  contextMIMEType(p),
			filePath:  p,
			skillName: fm.Name,
		}
		if relSlash == skillFileName {
			// The skill entry point carries the skill's identity.
			res.name = fm.Name
			res.description = fm.Description
		} else if path.Base(relSlash) == skillFileName {
			// SEP-2640 permits nested skills; from this skill's perspective a
			// nested SKILL.md is ordinary supporting content.
			logger.Debug("Nested SKILL.md served as supporting content of the enclosing skill",
				zap.String("file", p), zap.String("skill", fm.Name))
		}
		files = append(files, res)
		return nil
	})
	if walkErr != nil {
		logger.Error("Skipping invalid MCP skill directory", zap.String("dir", root), zap.Error(walkErr))
		return
	}
	if len(files) > maxSkillFiles || totalBytes > maxSkillTotalBytes {
		logger.Error("Skipping MCP skill exceeding size limits",
			zap.String("dir", root), zap.String("skill", fm.Name),
			zap.Int("files", len(files)), zap.Int64("total_bytes", totalBytes))
		return
	}

	scan.skills = append(scan.skills, contextSkill{
		name:        fm.Name,
		description: fm.Description,
		uri:         skillFileURI(skillPath, skillFileName),
	})
	for _, res := range files {
		scan.add(res)
	}
}
