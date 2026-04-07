package integration

import (
	"fmt"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

func TestOCIPlugin_PullAndRun(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)

	projectsBinary := fmt.Sprintf("../router/plugins/projects/bin/%s_%s", runtime.GOOS, runtime.GOARCH)
	coursesBinary := fmt.Sprintf("../router/plugins/courses/bin/%s_%s", runtime.GOOS, runtime.GOARCH)

	buildAndPushPluginImage(t, registryHost, "test-org/projects", "v1", projectsBinary)
	buildAndPushPluginImage(t, registryHost, "test-org/courses", "v1", coursesBinary)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { projects { id name } }`,
		})
		require.Equal(t, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)

		response = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { courses { id title description } }`,
		})
		require.Equal(t, `{"data":{"courses":[{"id":"1","title":"Introduction to TypeScript","description":"Learn the basics of TypeScript"},{"id":"2","title":"Advanced GraphQL","description":"Master GraphQL federation"},{"id":"3","title":"Go Programming","description":"Build services with Go"}]}}`, response.Body)
	})
}

func TestOCIPlugin_ImageNotFound(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)
	// Don't push any images — registry is empty

	testenv.FailsOnStartup(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, err error) {
		require.ErrorContains(t, err, "pulling image")
	})
}

func TestOCIPlugin_Restart(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)

	projectsBinary := fmt.Sprintf("../router/plugins/projects/bin/%s_%s", runtime.GOOS, runtime.GOARCH)
	coursesBinary := fmt.Sprintf("../router/plugins/courses/bin/%s_%s", runtime.GOOS, runtime.GOARCH)

	buildAndPushPluginImage(t, registryHost, "test-org/projects", "v1", projectsBinary)
	buildAndPushPluginImage(t, registryHost, "test-org/courses", "v1", coursesBinary)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.ErrorLevel,
		},
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { killService }`,
		})

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			logMessages := xEnv.Observer().All()
			require.True(c, slices.ContainsFunc(logMessages, func(msg observer.LoggedEntry) bool {
				return strings.Contains(msg.Message, "plugin process exited")
			}), "expected to find 'plugin process exited' message in logs")
		}, 5*time.Second, 1*time.Second)

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			response, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
			})
			require.NoError(c, err)
			require.Equal(c, 200, response.Response.StatusCode)
			require.Equal(c, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)
		}, 20*time.Second, 2*time.Second)
	})
}

// addOCIImageReferences adds imageReference fields to plugin datasources,
// deriving the OCI config from the base plugins config at runtime.
func addOCIImageReferences(routerConfig *nodev1.RouterConfig) {
	for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
		plugin := ds.GetCustomGraphql().GetGrpc().GetPlugin()
		if plugin == nil {
			continue
		}
		switch plugin.Name {
		case "projects":
			plugin.ImageReference = &nodev1.ImageReference{
				Repository: "test-org/projects",
				Reference:  "v1",
			}
		case "courses":
			plugin.ImageReference = &nodev1.ImageReference{
				Repository: "test-org/courses",
				Reference:  "v1",
			}
		}
	}
}
