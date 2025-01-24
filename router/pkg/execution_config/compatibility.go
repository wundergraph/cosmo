package execution_config

import (
	"fmt"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

const (
	// ExecutionConfigVersionThreshold should ONLY be updated if there is a breaking change in the router execution config.
	ExecutionConfigVersionThreshold         = 1
	compatibilityVersionParseErrorMessage   = "Failed to parse compatibility version."
	executionConfigVersionParseErrorMessage = "Failed to parse router execution config version of compatibility version."
)

func IsRouterCompatibleWithExecutionConfig(logger *zap.Logger, compatibilityVersion string) bool {
	if compatibilityVersion == "" {
		return true
	}
	/* A compatibility version is composed thus: <router execution configuration version>:<composition package version>
	 * A router version supports a maximum router execution configuration version (ExecutionConfigVersionThreshold).
	 * In the event the execution config version exceeds ExecutionConfigVersionThreshold, an error will request for
	 * the router version be upgraded.
	 * If the router version requires a newer router execution configuration version, a warning will explain that some
	 * new features may be unavailable or functionality/behaviour may have changed.
	 */
	segments := strings.Split(compatibilityVersion, ":")
	if len(segments) != 2 {
		logger.Error(compatibilityVersionParseErrorMessage, zap.String("compatibility_version", compatibilityVersion))
		return false
	}
	routerExecutionVersion, err := strconv.ParseInt(segments[0], 10, 32)
	if err != nil {
		logger.Error(executionConfigVersionParseErrorMessage, zap.String("compatibility_version", compatibilityVersion))
		return false
	}
	switch {
	case routerExecutionVersion == ExecutionConfigVersionThreshold:
		return true
	case routerExecutionVersion > ExecutionConfigVersionThreshold:
		logger.Error(
			executionConfigVersionThresholdExceededError(routerExecutionVersion),
			zap.Int64("execution_config_version", routerExecutionVersion),
			zap.String("composition_package_version", segments[1]),
		)
		return false
	default:
		logger.Warn(
			executionConfigVersionInsufficientWarning(routerExecutionVersion),
			zap.Int64("execution_config_version", routerExecutionVersion),
			zap.String("composition_package_version", segments[1]),
		)
		return true
	}
}

func executionConfigVersionThresholdExceededError(executionConfigVersion int64) string {
	return fmt.Sprintf(
		"This router version supports a router execution config version up to %d. The router execution config version supplied is %d. Please upgrade your router version.",
		ExecutionConfigVersionThreshold,
		executionConfigVersion,
	)
}

func executionConfigVersionInsufficientWarning(executionConfigVersion int64) string {
	return fmt.Sprintf(
		"This router version requires a minimum router execution config version of %d to support all functionality. The router execution config version supplied is %d. Please create a new execution configuration.",
		ExecutionConfigVersionThreshold,
		executionConfigVersion,
	)
}
