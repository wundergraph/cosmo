package eventdata

import (
	"bytes"
	"encoding/json"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func BuildEventDataBytes(ref int, visitor *plan.Visitor, variables *resolve.Variables) ([]byte, error) {
	// Collect the field arguments for fetch based operations
	fieldArgs := visitor.Operation.FieldArguments(ref)
	var dataBuffer bytes.Buffer
	dataBuffer.WriteByte('{')
	for i, arg := range fieldArgs {
		if i > 0 {
			dataBuffer.WriteByte(',')
		}
		argValue := visitor.Operation.ArgumentValue(arg)
		variableName := visitor.Operation.VariableValueNameBytes(argValue.Ref)
		contextVariable := &resolve.ContextVariable{
			Path:     []string{string(variableName)},
			Renderer: resolve.NewPlainVariableRenderer(),
		}
		variablePlaceHolder, _ := variables.AddVariable(contextVariable)
		argumentName := visitor.Operation.ArgumentNameString(arg)
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
