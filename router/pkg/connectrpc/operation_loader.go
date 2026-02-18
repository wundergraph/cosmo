package connectrpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// LoadOperationsForService loads GraphQL operations for a specific service from operation files.
// Operations are scoped to the service's fully qualified name (package.service).
// Returns a map of operation name -> Operation for the service.
func LoadOperationsForService(serviceName string, operationFiles []string, logger *zap.Logger) (map[string]*schemaloader.Operation, error) {
	if serviceName == "" {
		return nil, fmt.Errorf("service name cannot be empty")
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	logger.Debug("loading operations for service",
		zap.String("service", serviceName),
		zap.Int("file_count", len(operationFiles)))

	operations := make(map[string]*schemaloader.Operation)

	// Track operation names to detect duplicates within this service
	seenOperations := make(map[string]string) // operation name -> file path

	// Load each operation file
	for _, filePath := range operationFiles {
		content, err := os.ReadFile(filePath)
		if err != nil {
			logger.Warn("failed to read operation file",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		operationString := string(content)

		// Parse to extract operation name and type
		opDoc, report := astparser.ParseGraphqlDocumentString(operationString)
		if report.HasErrors() {
			logger.Warn("failed to parse operation file",
				zap.String("file", filePath),
				zap.String("error", report.Error()))
			continue
		}

		// Validate exactly one operation per file
		operationCount := len(opDoc.OperationDefinitions)
		if operationCount != 1 {
			logger.Warn("expected exactly one operation definition in file",
				zap.String("file", filePath),
				zap.Int("operation_count", operationCount))
			continue
		}

		// Extract operation name and type
		opName, opType, err := schemaloader.GetOperationNameAndType(&opDoc)
		if err != nil {
			logger.Warn("failed to extract operation info",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		// If no operation name, use filename without extension
		if opName == "" {
			opName = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
		}

		// Check for duplicate operation names within this service
		if existingFile, exists := seenOperations[opName]; exists {
			logger.Warn("duplicate operation name within service, last one wins",
				zap.String("service", serviceName),
				zap.String("operation", opName),
				zap.String("previous_file", existingFile),
				zap.String("current_file", filePath))
		}

		operation := &schemaloader.Operation{
			Name:            opName,
			FilePath:        filePath,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
		}

		operations[opName] = operation
		seenOperations[opName] = filePath

		logger.Debug("loaded operation for service",
			zap.String("service", serviceName),
			zap.String("operation", opName),
			zap.String("type", opType),
			zap.String("file", filePath))
	}

	// Return error if operation files were provided but none were successfully loaded
	if len(operationFiles) > 0 && len(operations) == 0 {
		return nil, fmt.Errorf("all %d operation file(s) failed to load for service %s", len(operationFiles), serviceName)
	}

	logger.Info("loaded operations for service",
		zap.String("service", serviceName),
		zap.Int("operation_count", len(operations)))

	return operations, nil
}

