package grpcsource

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// upstream is the gRPC service as currently configured.
type upstream struct {
	// connection is nil when no target is configured.
	connection *grpc.ClientConn
	headers    map[string]string
	timeout    time.Duration
}

// call answers one RPC with one unary call to the upstream service.
func (u *upstream) call(
	ctx context.Context,
	operation operation,
	method protoreflect.MethodDescriptor,
	names names,
	request *dynamicpb.Message,
	response *dynamicpb.Message,
) error {
	if u.connection == nil {
		return status.Errorf(codes.FailedPrecondition, "modules.%s.target is not set", moduleID)
	}

	upstreamRequest := dynamicpb.NewMessage(method.Input())
	if err := convertRequest(request, upstreamRequest, names); err != nil {
		return status.Errorf(codes.InvalidArgument, "%s: %v", operation.Method, err)
	}

	ctx, cancel := context.WithTimeout(ctx, u.timeout)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.New(u.headers))

	upstreamResponse := dynamicpb.NewMessage(method.Output())
	if err := u.connection.Invoke(ctx, operation.Method, upstreamRequest, upstreamResponse); err != nil {
		upstreamStatus := status.Convert(err)
		// A missing resource is a null field, not a failed request.
		if upstreamStatus.Code() == codes.NotFound {
			return nil
		}
		return status.Errorf(upstreamStatus.Code(), "%s: %s", operation.Method, upstreamStatus.Message())
	}

	if err := fill(response, upstreamResponse, operation, names); err != nil {
		return status.Errorf(codes.Internal, "%s: %v", operation.Method, err)
	}
	return nil
}

// convertRequest reads the contract request into the upstream request, renaming fields and enum values.
func convertRequest(request *dynamicpb.Message, upstreamRequest *dynamicpb.Message, names names) error {
	fields, err := toJSON(request, protojson.MarshalOptions{UseProtoNames: true})
	if err != nil {
		return err
	}

	shaped, err := json.Marshal(names.convertObject(fields, request.Descriptor(), towardUpstream))
	if err != nil {
		return err
	}
	return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(shaped, upstreamRequest)
}

// fill puts the result of the upstream response into the one field of the contract response.
func fill(response *dynamicpb.Message, upstreamResponse *dynamicpb.Message, operation operation, names names) error {
	result := response.Descriptor().Fields().Get(0)

	var value any = true
	if operation.Returns != returnsEmpty {
		fields, err := toJSON(upstreamResponse, protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true})
		if err != nil {
			return err
		}

		var picked any = fields
		if operation.Returns == returnsField {
			picked = fields[operation.Field]
		}

		converted, kept := names.convert(picked, result, towardContract)
		if !kept {
			return nil
		}
		value = converted
	}

	shaped, err := json.Marshal(map[string]any{string(result.Name()): value})
	if err != nil {
		return err
	}
	return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(shaped, response)
}

// toJSON renders a message as protojson, so int64, wrappers, timestamps, bytes and enums arrive as JSON values
// both protos agree on.
func toJSON(message *dynamicpb.Message, options protojson.MarshalOptions) (map[string]any, error) {
	encoded, err := options.Marshal(message)
	if err != nil {
		return nil, err
	}

	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()

	fields := map[string]any{}
	if err := decoder.Decode(&fields); err != nil {
		return nil, err
	}
	return fields, nil
}

type direction int

const (
	towardUpstream direction = iota
	towardContract
)

// convert renames a protojson value between contract and upstream names, following the contract field it is
// read from or written to. It reports false for an enum value without a counterpart, which is left out.
func (n names) convert(value any, field protoreflect.FieldDescriptor, direction direction) (any, bool) {
	items, isList := value.([]any)
	if !field.IsList() || !isList {
		return n.convertSingle(value, field, direction)
	}

	converted := make([]any, 0, len(items))
	for _, item := range items {
		convertedItem, kept := n.convertSingle(item, field, direction)
		if kept {
			converted = append(converted, convertedItem)
		}
	}
	return converted, true
}

func (n names) convertSingle(value any, field protoreflect.FieldDescriptor, direction direction) (any, bool) {
	if enum := field.Enum(); enum != nil {
		name, isName := value.(string)
		if !isName {
			return nil, false
		}
		return n.convertEnum(name, enum, direction)
	}

	message := field.Message()
	// Well-known types render as plain JSON values that both protos read the same way.
	if message == nil || strings.HasPrefix(string(message.FullName()), "google.protobuf.") {
		return value, true
	}

	fields, isObject := value.(map[string]any)
	if !isObject {
		return value, true
	}
	return n.convertObject(fields, message, direction), true
}

func (n names) convertObject(fields map[string]any, message protoreflect.MessageDescriptor, direction direction) map[string]any {
	converted := map[string]any{}
	for contractName, upstreamName := range n.Messages[string(message.Name())] {
		field := message.Fields().ByName(protoreflect.Name(contractName))
		if field == nil {
			continue
		}

		from, to := contractName, upstreamName
		if direction == towardContract {
			from, to = upstreamName, contractName
		}

		value, present := fields[from]
		if !present {
			continue
		}

		convertedValue, kept := n.convert(value, field, direction)
		if kept {
			converted[to] = convertedValue
		}
	}
	return converted
}

func (n names) convertEnum(name string, enum protoreflect.EnumDescriptor, direction direction) (string, bool) {
	values := n.Enums[string(enum.Name())]
	if direction == towardUpstream {
		upstreamName, known := values[name]
		return upstreamName, known
	}

	for contractName, upstreamName := range values {
		if upstreamName == name {
			return contractName, true
		}
	}
	return "", false
}
