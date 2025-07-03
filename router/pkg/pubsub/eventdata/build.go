package eventdata

import (
	"bytes"
	"encoding/json"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func BuildEventDataBytes(ref int, operation *ast.Document, variables *resolve.Variables) ([]byte, error) {
	// Collect the field arguments for fetch-based operations
	fieldArgs := operation.FieldArguments(ref)
	var dataBuffer bytes.Buffer
	dataBuffer.WriteByte('{')
	for i, arg := range fieldArgs {
		if i > 0 {
			dataBuffer.WriteByte(',')
		}
		argValue := operation.ArgumentValue(arg)
		variableName := operation.VariableValueNameBytes(argValue.Ref)
		contextVariable := &resolve.ContextVariable{
			Path:     []string{string(variableName)},
			Renderer: resolve.NewJSONVariableRenderer(),
		}
		variablePlaceHolder, _ := variables.AddVariable(contextVariable)
		argumentName := operation.ArgumentNameString(arg)
		escapedKey, err := json.Marshal(argumentName)
		if err != nil {
			return nil, err
		}
		dataBuffer.Write(escapedKey)
		dataBuffer.WriteByte(':')
		dataBuffer.WriteString(variablePlaceHolder)
	}
	dataBuffer.WriteByte('}')
	return dataBuffer.Bytes(), nil
}
