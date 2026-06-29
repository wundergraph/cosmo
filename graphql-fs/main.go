// Command graphql-fs turns a GraphQL SDL into a navigable file tree.
//
// The idea: an LLM already knows how to explore a directory tree with
// ls/cat/grep/find. By projecting a GraphQL schema onto a filesystem we give
// the model progressive disclosure over a large schema instead of dumping the
// whole SDL into its context. Graph edges (a field's return type, the members
// of a union, the implementations of an interface) become symlinks, so the
// model can literally "follow" the graph by walking the tree.
//
// Usage:
//
//	graphql-fs -sdl <file|url> [-out <dir>]
//
// If -out is omitted a temp dir is created and its path is printed to stdout.
package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/parser"
	"github.com/vektah/gqlparser/v2/validator"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "build":
		runBuild(os.Args[2:])
	case "compare":
		runCompare(os.Args[2:])
	case "-h", "--help", "help":
		usage()
	default:
		// Backwards-compatible: treat bare flags as `build`.
		if strings.HasPrefix(os.Args[1], "-") {
			runBuild(os.Args[1:])
			return
		}
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		usage()
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `graphql-fs - project a GraphQL SDL onto a navigable file tree

usage:
  graphql-fs build   -sdl <file|url> [-out <dir>]
  graphql-fs compare -sdl <file|url> -expected <file> -generated <file> [-json]
`)
	os.Exit(2)
}

func newFlagSet(name string) *flag.FlagSet {
	return flag.NewFlagSet(name, flag.ExitOnError)
}

func runBuild(args []string) {
	fs := newFlagSet("build")
	sdlSrc := fs.String("sdl", "", "path or http(s) URL to a GraphQL SDL document")
	outDir := fs.String("out", "", "output directory (default: a fresh temp dir)")
	_ = fs.Parse(args)

	if *sdlSrc == "" {
		fmt.Fprintln(os.Stderr, "usage: graphql-fs build -sdl <file|url> [-out <dir>]")
		os.Exit(2)
	}

	sdl, err := loadSDL(*sdlSrc)
	if err != nil {
		fatal(fmt.Errorf("load sdl: %w", err))
	}

	schema, err := loadSchema(sdl)
	if err != nil {
		fatal(fmt.Errorf("parse schema: %w", err))
	}

	root := *outDir
	if root == "" {
		root, err = os.MkdirTemp("", "graphql-fs-")
		if err != nil {
			fatal(err)
		}
	} else if err := os.MkdirAll(root, 0o755); err != nil {
		fatal(err)
	}

	g := &Generator{Root: root, Schema: schema, SDL: sdl}
	if err := g.Generate(); err != nil {
		fatal(err)
	}

	fmt.Println(root)
}

// loadSchema parses and validates an SDL document. It mirrors
// gqlparser.LoadSchema (prepends the prelude, then validates) but first drops
// any user redeclarations of built-in types/directives. Real-world published
// schemas (e.g. monday.com) often re-declare scalars like Int with their own
// documentation, which would otherwise collide with the injected prelude.
func loadSchema(sdl string) (*ast.Schema, error) {
	doc, err := parser.ParseSchemas(validator.Prelude, &ast.Source{Name: "schema.graphql", Input: sdl})
	if err != nil {
		return nil, err
	}

	seenTypes := map[string]bool{}
	deduped := doc.Definitions[:0]
	for _, def := range doc.Definitions {
		if seenTypes[def.Name] {
			continue // prelude (parsed first) wins over later redeclarations
		}
		seenTypes[def.Name] = true
		deduped = append(deduped, def)
	}
	doc.Definitions = deduped

	seenDir := map[string]bool{}
	dedupedDir := doc.Directives[:0]
	for _, d := range doc.Directives {
		if seenDir[d.Name] {
			continue
		}
		seenDir[d.Name] = true
		dedupedDir = append(dedupedDir, d)
	}
	doc.Directives = dedupedDir

	return validator.ValidateSchemaDocument(doc)
}

// loadSDL reads an SDL document from a local path or an http(s) URL.
func loadSDL(src string) (string, error) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Get(src)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("GET %s: status %d", src, resp.StatusCode)
		}
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	b, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
