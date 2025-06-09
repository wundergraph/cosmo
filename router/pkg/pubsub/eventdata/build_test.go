package eventdata

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestBuildEventDataBytes(t *testing.T) {
	t.Run("check string serialization", func(t *testing.T) {
		const operation = "mutation HelloMutation($id: ID!) { helloMutation(userKey:{id:$id,tenantId:3}) { success } }"
		op, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors())
		var vars resolve.Variables
		_, err := BuildEventDataBytes(1, &op, &vars)
		require.NoError(t, err)
		require.Len(t, vars, 1)

		template := resolve.InputTemplate{
			Segments: []resolve.TemplateSegment{
				vars[0].TemplateSegment(),
			},
		}
		ctx := &resolve.Context{
			Variables: astjson.MustParseBytes([]byte(`{"id":"asdf"}`)),
		}
		buf := &bytes.Buffer{}
		err = template.Render(ctx, nil, buf)
		require.NoError(t, err)
		require.Equal(t, `"asdf"`, buf.String())
	})

	t.Run("check int serialization", func(t *testing.T) {
		const operation = "mutation HelloMutation($id: Int!) { helloMutation(userKey:{id:$id,tenantId:3}) { success } }"
		op, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors())
		var vars resolve.Variables
		_, err := BuildEventDataBytes(1, &op, &vars)
		require.NoError(t, err)
		require.Len(t, vars, 1)

		template := resolve.InputTemplate{
			Segments: []resolve.TemplateSegment{
				vars[0].TemplateSegment(),
			},
		}
		ctx := &resolve.Context{
			Variables: astjson.MustParseBytes([]byte(`{"id":5}`)),
		}
		buf := &bytes.Buffer{}
		err = template.Render(ctx, nil, buf)
		require.NoError(t, err)
		require.Equal(t, `5`, buf.String())
	})
}
