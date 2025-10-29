package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	sha256_verifier "github.com/wundergraph/cosmo/router-tests/modules/sha256-verifier"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestSha256VerifierModule(t *testing.T) {
	t.Parallel()

	t.Run("verify Sha256Hash is not captured when sha256 force is not enabled", func(t *testing.T) {
		t.Parallel()

		resultContainer := &sha256_verifier.ResultContainer{}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"sha256VerifierModule": sha256_verifier.Sha256VerifierModule{
					ForceSha256:     false,
					ResultContainer: resultContainer,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&sha256_verifier.Sha256VerifierModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, 200, res.Response.StatusCode)

			require.Empty(t, resultContainer.Sha256Result)
		})
	})

	t.Run("verify sha256Hash is captured from operation when force is enabled", func(t *testing.T) {
		t.Parallel()

		resultContainer := &sha256_verifier.ResultContainer{}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"sha256VerifierModule": sha256_verifier.Sha256VerifierModule{
					ForceSha256:     true,
					ResultContainer: resultContainer,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&sha256_verifier.Sha256VerifierModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, 200, res.Response.StatusCode)

			require.NotEmpty(t, resultContainer.Sha256Result)
			require.Equal(t, "f037469b9c85bb28ae4c13e1d51c1f7e3333ecbe3c28b877c8659a52378f56c0", resultContainer.Sha256Result)
		})
	})

	t.Run("verify different queries produces different Sha256Hashes", func(t *testing.T) {
		t.Parallel()

		resultContainer := &sha256_verifier.ResultContainer{}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"sha256VerifierModule": sha256_verifier.Sha256VerifierModule{
					ForceSha256:     true,
					ResultContainer: resultContainer,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&sha256_verifier.Sha256VerifierModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query ConsistentQuery { employees { id } }`,
				OperationName: json.RawMessage(`"ConsistentQuery"`),
			})
			require.NoError(t, err)
			firstHash := resultContainer.Sha256Result
			require.NotEmpty(t, firstHash)

			_, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query ConsistentQuery { employees { id tag } }`,
				OperationName: json.RawMessage(`"ConsistentQuery"`),
			})
			require.NoError(t, err)
			secondHash := resultContainer.Sha256Result
			require.NotEmpty(t, secondHash)

			require.NotEqual(t, firstHash, secondHash)
		})
	})

	t.Run("verify the same query produces same Sha256Hash", func(t *testing.T) {
		t.Parallel()

		resultContainer := &sha256_verifier.ResultContainer{}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"sha256VerifierModule": sha256_verifier.Sha256VerifierModule{
					ForceSha256:     true,
					ResultContainer: resultContainer,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&sha256_verifier.Sha256VerifierModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query ConsistentQuery { employees { id } }`,
				OperationName: json.RawMessage(`"ConsistentQuery"`),
			})
			require.NoError(t, err)
			firstHash := resultContainer.Sha256Result
			require.NotEmpty(t, firstHash)

			_, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query ConsistentQuery { employees { id } }`,
				OperationName: json.RawMessage(`"ConsistentQuery"`),
			})
			require.NoError(t, err)
			secondHash := resultContainer.Sha256Result
			require.NotEmpty(t, secondHash)

			require.Equal(t, firstHash, secondHash, "Same query should produce the same SHA256 hash")
		})
	})

}
