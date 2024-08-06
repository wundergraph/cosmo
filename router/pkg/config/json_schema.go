package config

import (
	_ "embed"
	"errors"
	"fmt"
	"github.com/dustin/go-humanize"
	"github.com/goccy/go-json"
	"github.com/goccy/go-yaml"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/message"
	"io/fs"
	"log"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	hostnameRegexStringRFC1123 = `^([a-zA-Z0-9]{1}[a-zA-Z0-9-]{0,62}){1}(\.[a-zA-Z0-9]{1}[a-zA-Z0-9-]{0,62})*?$` // accepts hostname starting with a digit https://tools.ietf.org/html/rfc1123
)

type duration struct {
	min time.Duration
	max time.Duration
}

func (d duration) Validate(ctx *jsonschema.ValidatorContext, v any) {
	// is within bounds
	val, ok := v.(string)
	if !ok {
		ctx.AddError(&validationErrorKind{
			fmt.Sprintf("invalid duration, given %s", val),
			"duration",
		})
		return
	}

	duration, err := time.ParseDuration(val)
	if err != nil {
		ctx.AddError(&validationErrorKind{
			fmt.Sprintf("invalid duration, given %s", val),
			"duration",
		})
		return
	}

	if d.min > 0 {
		if duration < d.min {
			ctx.AddError(&validationErrorKind{
				fmt.Sprintf("duration must be greater or equal than %s", d.min),
				"duration",
			})
			return
		}
	}

	if d.max > 0 {
		if duration > d.max {
			ctx.AddError(&validationErrorKind{
				fmt.Sprintf("duration must be less or equal than %s", d.max),
				"duration",
			})
			return
		}

	}
}

func goDurationVocab() *jsonschema.Vocabulary {
	schemaURL := "http://example.com/meta/duration"
	schema, err := jsonschema.UnmarshalJSON(strings.NewReader(`{
	"properties" : {
		"duration": {
			"type": "object",
			"additionalProperties": false,
			"properties": {
				"minimum": {
					"type": "string"
				},	
				"maximum": {
					"type": "string"
				}
			}
		}
	}
}`))
	if err != nil {
		log.Fatal(err)
	}

	c := jsonschema.NewCompiler()
	if err := c.AddResource(schemaURL, schema); err != nil {
		log.Fatal(err)
	}
	sch, err := c.Compile(schemaURL)
	if err != nil {
		log.Fatal(err)
	}

	return &jsonschema.Vocabulary{
		URL:     schemaURL,
		Schema:  sch,
		Compile: compileDuration,
	}
}

func compileDuration(ctx *jsonschema.CompilerContext, m map[string]any) (jsonschema.SchemaExt, error) {
	if val, ok := m["duration"]; ok {

		if mapVal, ok := val.(map[string]interface{}); ok {
			var minDuration, maxDuration time.Duration
			var err error

			minDurationString, ok := mapVal["minimum"].(string)
			if ok {
				minDuration, err = time.ParseDuration(minDurationString)
				if err != nil {
					return nil, err
				}
			}
			maxDurationString, ok := mapVal["maximum"].(string)
			if ok {
				maxDuration, err = time.ParseDuration(maxDurationString)
				if err != nil {
					return nil, err
				}
			}
			return duration{
				min: minDuration,
				max: maxDuration,
			}, nil
		}

		return duration{}, nil
	}
	// nothing to compile, return nil
	return nil, nil
}

type humanBytes struct {
	min uint64
	max uint64
}

var (
	_ jsonschema.ErrorKind = (*validationErrorKind)(nil)
)

type validationErrorKind struct {
	message string
	jsonKey string
}

func (v validationErrorKind) KeywordPath() []string {
	return []string{v.jsonKey}
}

func (v validationErrorKind) LocalizedString(printer *message.Printer) string {
	return v.message
}

func (d humanBytes) Validate(ctx *jsonschema.ValidatorContext, v any) {

	val, ok := v.(string)
	if !ok {
		ctx.AddError(&validationErrorKind{
			fmt.Sprintf("invalid bytes, given %s", v),
			"bytes",
		})
		return
	}

	bytes, err := humanize.ParseBytes(val)
	if err != nil {
		ctx.AddError(&validationErrorKind{
			fmt.Sprintf("invalid bytes, given %s", val),
			"bytes",
		})
		return
	}

	if d.min > 0 {
		if bytes < d.min {
			ctx.AddError(&validationErrorKind{
				fmt.Sprintf("bytes must be greater or equal than %s", humanize.Bytes(d.min)),
				"bytes",
			})
			return
		}
	}

	if d.max > 0 {
		if bytes > d.max {
			ctx.AddError(&validationErrorKind{
				fmt.Sprintf("bytes must be less or equal than %s", humanize.Bytes(d.max)),
				"bytes",
			})
			return
		}

	}
}

func humanBytesVocab() *jsonschema.Vocabulary {
	schemaURL := "http://example.com/meta/humanBytes"
	schema, err := jsonschema.UnmarshalJSON(strings.NewReader(`{
	"properties" : {
		"bytes": {
			"type": "object",
			"additionalProperties": false,
			"properties": {
				"minimum": {
					"type": "string"
				},	
				"minimum": {
					"type": "string"
				}
			}
		}
	}
}`))
	if err != nil {
		log.Fatal(err)
	}

	c := jsonschema.NewCompiler()
	if err := c.AddResource(schemaURL, schema); err != nil {
		log.Fatal(err)
	}
	sch, err := c.Compile(schemaURL)
	if err != nil {
		log.Fatal(err)
	}

	return &jsonschema.Vocabulary{
		URL:     schemaURL,
		Schema:  sch,
		Compile: compileHumanBytes,
	}
}

func compileHumanBytes(ctx *jsonschema.CompilerContext, m map[string]any) (jsonschema.SchemaExt, error) {
	if val, ok := m["bytes"]; ok {

		if mapVal, ok := val.(map[string]interface{}); ok {
			var minBytes, maxBytes uint64
			var err error

			minBytesString, ok := mapVal["minimum"].(string)
			if ok {
				minBytes, err = humanize.ParseBytes(minBytesString)
				if err != nil {
					return nil, err
				}
			}
			maxBytesString, ok := mapVal["maximum"].(string)
			if ok {
				maxBytes, err = humanize.ParseBytes(maxBytesString)
				if err != nil {
					return nil, err
				}
			}
			return humanBytes{
				min: minBytes,
				max: maxBytes,
			}, nil
		}

		return humanBytes{}, nil
	}

	// nothing to compile, return nil
	return nil, nil
}

var (
	//go:embed config.schema.json
	JSONSchema []byte

	hostnameRegexRFC1123 = regexp.MustCompile(hostnameRegexStringRFC1123)
)

func ValidateConfig(yamlData []byte, schema []byte) error {
	var s any
	err := json.Unmarshal(schema, &s)
	if err != nil {
		return err
	}

	var v any
	if err := yaml.Unmarshal(yamlData, &v); err != nil {
		log.Fatal(err)
	}

	c := jsonschema.NewCompiler()
	c.AssertFormat()
	c.AssertVocabs()
	c.RegisterFormat(&jsonschema.Format{
		Name:     "go-duration",
		Validate: isGoDuration,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "bytes-string",
		Validate: isBytesString,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "url",
		Validate: isURL,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "http-url",
		Validate: isHttpURL,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "file-path",
		Validate: isFilePath,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "x-uri",
		Validate: isURI,
	})
	c.RegisterFormat(&jsonschema.Format{
		Name:     "hostname-port",
		Validate: isHostnamePort,
	})
	c.RegisterVocabulary(goDurationVocab())
	c.RegisterVocabulary(humanBytesVocab())

	err = c.AddResource("https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json", s)
	if err != nil {
		return err
	}

	sch, err := c.Compile("https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json")
	if err != nil {
		return err
	}

	err = sch.Validate(v)
	if err != nil {
		return err
	}

	return nil
}

// isGoDuration is the validation function for validating if the current field's value is a valid Go duration.
func isGoDuration(s any) error {
	val, ok := s.(string)
	if !ok {
		return errors.New("invalid duration")
	}
	_, err := time.ParseDuration(val)
	return err
}

// isBytesString is the validation function for validating if the current field's value is a valid bytes string.
func isBytesString(s any) error {
	val, ok := s.(string)
	if !ok {
		return errors.New("invalid bytes string")
	}
	_, err := humanize.ParseBytes(val)
	return err
}

// isFileURL is the helper function for validating if the `path` valid file URL as per RFC8089
func isFileURL(path string) bool {
	if !strings.HasPrefix(path, "file:/") {
		return false
	}
	_, err := url.ParseRequestURI(path)
	return err == nil
}

// isURL is the validation function for validating if the current field's value is a valid URL.
func isURL(a any) error {
	val, ok := a.(string)
	if !ok {
		return errors.New("invalid URL")
	}
	s := strings.ToLower(val)

	if len(s) == 0 {
		return errors.New("invalid URL")
	}

	if isFileURL(s) {
		return errors.New("invalid URL")
	}

	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" {
		return errors.New("invalid URL")
	}

	if u.Host == "" && u.Fragment == "" && u.Opaque == "" {
		return errors.New("invalid URL")
	}

	return nil
}

// isHttpURL is the validation function for validating if the current field's value is a valid HTTP(s) URL.
func isHttpURL(a any) error {
	val, ok := a.(string)
	if !ok {
		return errors.New("invalid HTTP URL")
	}

	if err := isURL(val); err != nil {
		return err
	}

	s := strings.ToLower(val)

	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return errors.New("invalid HTTP URL")
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("invalid HTTP scheme")
	}

	return nil
}

// isDir is the validation function for validating if the current field's value is a valid existing directory.
func isDir(s string) bool {
	fileInfo, err := os.Stat(s)
	if err != nil {
		return false
	}

	return fileInfo.IsDir()
}

// isFile is the validation function for validating if the current field's value is a valid existing file path.
func isFile(s string) bool {
	fileInfo, err := os.Stat(s)
	if err != nil {
		return false
	}

	return !fileInfo.IsDir()
}

// isFilePath is the validation function for validating if the current field's value is a valid file path.
func isFilePath(a any) error {
	val, ok := a.(string)
	if !ok {
		return errors.New("invalid file path")
	}

	var exists bool

	// Not valid if it is a directory.
	if isDir(val) {
		return errors.New("invalid file path")
	}
	// If it exists, it obviously is valid.
	// This is done first to avoid code duplication and unnecessary additional logic.
	if exists = isFile(val); exists {
		return nil
	}

	// Every OS allows for whitespace, but none
	// let you use a file with no filename (to my knowledge).
	// Unless you're dealing with raw inodes, but I digress.
	if strings.TrimSpace(val) == "" {
		return errors.New("invalid file path")
	}

	// We make sure it isn't a directory.
	if strings.HasSuffix(val, string(os.PathSeparator)) {
		return errors.New("invalid file path")
	}

	if _, err := os.Stat(val); err != nil {
		var t *fs.PathError
		switch {
		case errors.As(err, &t):
			if errors.Is(t.Err, syscall.EINVAL) {
				// It's definitely an invalid character in the filepath.
				return errors.New("invalid file path")
			}
			// It could be a permission error, a does-not-exist error, etc.
			// Out-of-scope for this validation, though.
			return nil
		default:
			// Something went *seriously* wrong.
			/*
				Per https://pkg.go.dev/os#Stat:
					"If there is an error, it will be of type *PathError."
			*/
			panic(err)
		}
	}

	return nil
}

// isURI is the validation function for validating if the current field's value is a valid URI.
func isURI(a any) error {
	val, ok := a.(string)
	if !ok {
		return errors.New("invalid URI")
	}

	// checks needed as of Go 1.6 because of change https://github.com/golang/go/commit/617c93ce740c3c3cc28cdd1a0d712be183d0b328#diff-6c2d018290e298803c0c9419d8739885L195
	// emulate browser and strip the '#' suffix prior to validation. see issue-#237
	if i := strings.Index(val, "#"); i > -1 {
		val = val[:i]
	}

	if len(val) == 0 {
		return errors.New("invalid URI")
	}

	_, err := url.ParseRequestURI(val)

	return err
}

// isHostnamePort validates a <dns>:<port> combination for fields typically used for socket address.
func isHostnamePort(a any) error {
	val, ok := a.(string)
	if !ok {
		return errors.New("invalid hostname:port")
	}

	host, port, err := net.SplitHostPort(val)
	if err != nil {
		return err
	}
	// Port must be an iny <= 65535.
	if portNum, err := strconv.ParseInt(
		port, 10, 32,
	); err != nil || portNum > 65535 || portNum < 1 {
		return errors.New("invalid port")
	}

	// If host is specified, it should match a DNS name
	if host != "" {
		if !hostnameRegexRFC1123.MatchString(host) {
			return errors.New("invalid hostname")
		}
	}
	return nil
}
