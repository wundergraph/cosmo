package execution_config

import (
	"fmt"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

const (
	// RouterCompatibilityVersionThreshold should ONLY be updated if there is a breaking change in the router execution config.
	RouterCompatibilityVersionThreshold         = 1
	compatibilityVersionParseErrorMessage       = "Failed to parse compatibility version."
	routerCompatibilityVersionParseErrorMessage = "Failed to parse router execution config version of compatibility version."
)

func IsRouterCompatibleWithExecutionConfig(logger *zap.Logger, compatibilityVersion string) bool {
	if compatibilityVersion == "" {
		return true
	}
	/* A compatibility version is composed thus: <router compatibility version>:<composition package version>
	 * A router version supports a maximum router compatibility version (RouterCompatibilityVersionThreshold).
	 * In the event the execution config version exceeds RouterCompatibilityVersionThreshold, an error will request the
	 * router version be upgraded.
	 * If the router version requires a newer router execution configuration version, a warning will explain that some
	 * new features may be unavailable or functionality/behaviour may have changed.
	 */
	segments := strings.Split(compatibilityVersion, ":")
	if len(segments) != 2 {
		logger.Error(compatibilityVersionParseErrorMessage, zap.String("compatibility_version", compatibilityVersion))
		return false
	}
	routerCompatibilityVersion, err := strconv.ParseInt(segments[0], 10, 32)
	if err != nil {
		logger.Error(routerCompatibilityVersionParseErrorMessage, zap.String("compatibility_version", compatibilityVersion))
		return false
	}
	switch {
	case routerCompatibilityVersion == RouterCompatibilityVersionThreshold:
		return true
	case routerCompatibilityVersion > RouterCompatibilityVersionThreshold:
		logger.Error(
			executionConfigVersionThresholdExceededError(routerCompatibilityVersion),
			zap.Int64("router_compatibility_version", routerCompatibilityVersion),
			zap.String("composition_package_version", segments[1]),
		)
		return false
	default:
		logger.Warn(
			executionConfigVersionInsufficientWarning(routerCompatibilityVersion),
			zap.Int64("router_compatibility_version", routerCompatibilityVersion),
			zap.String("composition_package_version", segments[1]),
		)
		return true
	}
}

func executionConfigVersionThresholdExceededError(executionConfigVersion int64) string {
	return fmt.Sprintf(
		"This router version supports a router execution config version up to %d. The router execution config version supplied is %d. Please upgrade your router version.",
		RouterCompatibilityVersionThreshold,
		executionConfigVersion,
	)
}

func executionConfigVersionInsufficientWarning(executionConfigVersion int64) string {
	return fmt.Sprintf(
		"This router version requires a minimum router execution config version of %d to support all functionality. The router execution config version supplied is %d. Please create a new execution configuration.",
		RouterCompatibilityVersionThreshold,
		executionConfigVersion,
	)
}
