package schemaloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/wundergraph/cosmo/router/pkg/watcher"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
)

// Operation represents a GraphQL operation with its AST document and schema information
type Operation struct {
	Name            string
	FilePath        string
	Document        ast.Document
	OperationString string
	Description     string
	JSONSchema      json.RawMessage
	OperationType   string // "query", "mutation", or "subscription"
}

// OperationLoader loads GraphQL operations from files in a directory
type OperationLoader struct {
	// SchemaDocument is the parsed GraphQL schema document
	SchemaDocument *ast.Document
	// Logger is the logger used for logging
	Logger *zap.Logger
}

// NewOperationLoader creates a new OperationLoader with the given schema document
func NewOperationLoader(logger *zap.Logger, schemaDoc *ast.Document) *OperationLoader {
	return &OperationLoader{
		SchemaDocument: schemaDoc,
		Logger:         logger,
	}
}

// LoadOperationsFromDirectory loads all GraphQL operations from files in the specified directory
func (l *OperationLoader) LoadOperationsFromDirectory(ReloadOperationsChan chan bool, dirPath string) ([]Operation, error) {
	var operations []Operation

	// Create an operation validator
	validator := astvalidation.DefaultOperationValidator()

	fileDescriptor, err := syscall.InotifyInit()
	if err != nil {
		return nil, err
	}

	watchDescriptor, err := syscall.InotifyAddWatch(fileDescriptor, dirPath, syscall.IN_CREATE|syscall.IN_DELETE|syscall.IN_DELETE_SELF)
	if err != nil {
		return nil, err
	}

	pathCtx, pathCtxCancel := context.WithCancel(context.Background())

	startupDelay := 5 * time.Second

	go func() {
		inotifyEvent := make([]byte, 4096)
		for {
			_, err := syscall.Read(fileDescriptor, inotifyEvent)
			if err != nil {
				break
			}

			var event *syscall.InotifyEvent = (*syscall.InotifyEvent)(unsafe.Pointer(&inotifyEvent[0]))

			if event.Mask&syscall.IN_CREATE == syscall.IN_CREATE || event.Mask&syscall.IN_DELETE == syscall.IN_DELETE || event.Mask&syscall.IN_DELETE_SELF == syscall.IN_DELETE_SELF {
				break
			}

		}
		syscall.InotifyRmWatch(fileDescriptor, uint32(watchDescriptor))
		ReloadOperationsChan <- true
		pathCtxCancel()
	}()

	l.Logger.Info("Will walk through " + dirPath)
	// Walk through the directory and process GraphQL files
	err = filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Only process GraphQL files
		if !isGraphQLFile(path) {
			return nil
		}

		// Read the file
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		watchFunc, err := watcher.New(watcher.Options{
			Interval: 10 * time.Second,
			Logger:   l.Logger,
			Path:     path,
			Callback: func() {
				ReloadOperationsChan <- true
				pathCtxCancel()
			},
		})

		if err != nil {
			l.Logger.Error("Could not create watcher", zap.Error(err))
			return err
		}

		go func() {
			time.Sleep(startupDelay)
			if err := watchFunc(pathCtx); err != nil {
				if !errors.Is(err, context.Canceled) {
					l.Logger.Error("Error watching operations path", zap.Error(err))
				} else {
					l.Logger.Debug("Watcher context cancelled, shutting down")
				}
			}
		}()

		// Parse the operation
		operationString := string(content)
		opDoc, err := parseOperation(path, operationString)
		if err != nil {
			l.Logger.Error("Failed to parse MCP operation", zap.String("file", path), zap.Error(err))
			return nil
		}

		// Extract the operation name and type
		opName, opType, err := getOperationNameAndType(&opDoc)
		if err != nil {
			l.Logger.Error("Failed to extract MCP operation name and type", zap.String("operation", opName), zap.String("file", path), zap.Error(err))
			return nil
		}

		// Check if the operation type is supported
		if opType == "subscription" {
			l.Logger.Error("Subscriptions in MCP are not supported yet", zap.String("operation", opName), zap.String("file", path))
			return nil
		}

		// Validate operation against schema
		validationReport := operationreport.Report{}
		validationState := validator.Validate(&opDoc, l.SchemaDocument, &validationReport)
		if validationState == astvalidation.Invalid {
			l.Logger.Error("Invalid MCP operation",
				zap.String("operation", opName),
				zap.String("file", path),
				zap.String("errors", validationReport.Error()))
			return nil
		}

		// if not the operation name, use the file name without the extension
		if opName == "" {
			opName = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		}

		// Check if the operation name is unique
		for _, op := range operations {
			if op.Name == opName {
				l.Logger.Error("MCP operation already exists", zap.String("operation", opName), zap.String("file", path))
				return nil
			}
		}

		// Add to our list of operations
		operations = append(operations, Operation{
			Name:            opName,
			FilePath:        path,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
		})

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking mcp operations directory %s: %w", dirPath, err)
	}

	return operations, nil
}

// isGraphQLFile checks if a file is a GraphQL file based on its extension
func isGraphQLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".graphql" || ext == ".gql"
}

// parseOperation parses a GraphQL operation string into an AST document
func parseOperation(path string, operation string) (ast.Document, error) {
	opDoc, report := astparser.ParseGraphqlDocumentString(operation)
	if report.HasErrors() {
		return ast.Document{}, fmt.Errorf("parsing errors: %s", report.Error())
	}

	operationCount := len(opDoc.OperationDefinitions)
	if operationCount != 1 {
		return ast.Document{}, fmt.Errorf("expected exactly one operation definition in file %s, got %d", path, operationCount)
	}

	return opDoc, nil
}

// getOperationNameAndType extracts the name and type of the first operation in a document
func getOperationNameAndType(doc *ast.Document) (string, string, error) {
	for _, ref := range doc.RootNodes {
		if ref.Kind == ast.NodeKindOperationDefinition {
			opDef := doc.OperationDefinitions[ref.Ref]
			opType := ""
			switch opDef.OperationType {
			case ast.OperationTypeQuery:
				opType = "query"
			case ast.OperationTypeMutation:
				opType = "mutation"
			case ast.OperationTypeSubscription:
				opType = "subscription" // Not supported yet
			default:
				return "", "", fmt.Errorf("unknown operation type %d", opDef.OperationType)
			}

			if opDef.Name.Length() > 0 {
				return doc.Input.ByteSliceString(opDef.Name), opType, nil
			}
			return "", opType, nil
		}
	}
	return "", "", fmt.Errorf("no operation found in document")
}
