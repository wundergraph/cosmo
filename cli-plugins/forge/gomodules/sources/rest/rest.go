package restsource

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// upstream is the REST API as currently configured.
type upstream struct {
	baseURL string
	headers map[string]string
	client  *http.Client
}

// call answers one RPC with one request to the REST API.
func (u *upstream) call(
	ctx context.Context,
	operation operation,
	types map[string]map[string]string,
	request *dynamicpb.Message,
	response *dynamicpb.Message,
) error {
	target, err := u.target(operation, request)
	if err != nil {
		return status.Error(codes.InvalidArgument, err.Error())
	}

	httpRequest, err := http.NewRequestWithContext(ctx, operation.Method, target, nil)
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	httpRequest.Header.Set("Accept", "application/json")
	for name, value := range u.headers {
		httpRequest.Header.Set(name, value)
	}

	httpResponse, err := u.client.Do(httpRequest)
	if err != nil {
		return status.Errorf(codes.Unavailable, "%s %s: %v", operation.Method, operation.Path, err)
	}
	defer httpResponse.Body.Close()

	body, err := io.ReadAll(httpResponse.Body)
	if err != nil {
		return status.Errorf(codes.Unavailable, "%s %s: %v", operation.Method, operation.Path, err)
	}

	// A missing resource is a null field, not a failed request.
	if httpResponse.StatusCode == http.StatusNotFound {
		return nil
	}
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode > 299 {
		return status.Errorf(statusCode(httpResponse.StatusCode), "%s %s returned %d", operation.Method, operation.Path, httpResponse.StatusCode)
	}

	if err := fill(response, body, types); err != nil {
		return status.Errorf(codes.Internal, "%s %s: %v", operation.Method, operation.Path, err)
	}
	return nil
}

func statusCode(httpStatus int) codes.Code {
	switch {
	case httpStatus == http.StatusUnauthorized:
		return codes.Unauthenticated
	case httpStatus == http.StatusForbidden:
		return codes.PermissionDenied
	case httpStatus >= 500:
		return codes.Unavailable
	default:
		return codes.Internal
	}
}

// target builds the URL of an operation from the arguments in the request message.
func (u *upstream) target(operation operation, request *dynamicpb.Message) (string, error) {
	path := operation.Path
	query := url.Values{}

	for _, parameter := range operation.Parameters {
		value, set := argument(request, parameter.Field)
		if parameter.In == "path" {
			if !set || value == "" {
				return "", fmt.Errorf("argument %s is required", parameter.Field)
			}
			path = strings.ReplaceAll(path, "{"+parameter.Name+"}", url.PathEscape(value))
			continue
		}
		if set {
			query.Set(parameter.Name, value)
		}
	}

	target := strings.TrimRight(u.baseURL, "/") + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	return target, nil
}

// argument reads a request field as text. A nullable argument is a wrapper message that is unset when null.
func argument(request *dynamicpb.Message, fieldName string) (string, bool) {
	field := request.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil {
		return "", false
	}

	value := request.Get(field)
	if field.Kind() != protoreflect.MessageKind {
		return value.String(), true
	}
	if !request.Has(field) {
		return "", false
	}

	wrapped := field.Message().Fields().ByName("value")
	if wrapped == nil {
		return "", false
	}
	return value.Message().Get(wrapped).String(), true
}

// fill puts the REST response body into the one field of the response message.
func fill(response *dynamicpb.Message, body []byte, types map[string]map[string]string) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return fmt.Errorf("the response is not JSON: %w", err)
	}

	result := response.Descriptor().Fields().Get(0)
	shaped, err := json.Marshal(map[string]any{string(result.Name()): rename(payload, result, types)})
	if err != nil {
		return err
	}

	return protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(shaped, response)
}

// rename rewrites REST property names to proto field names, following the message the value is read into.
func rename(value any, field protoreflect.FieldDescriptor, types map[string]map[string]string) any {
	message := field.Message()
	if message == nil {
		return value
	}

	switch typed := value.(type) {
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, rename(item, field, types))
		}
		return items
	case map[string]any:
		fields := types[string(message.Name())]
		renamed := make(map[string]any, len(typed))
		for property, propertyValue := range typed {
			name, known := fields[property]
			if !known {
				continue
			}
			child := message.Fields().ByName(protoreflect.Name(name))
			if child == nil {
				continue
			}
			renamed[name] = rename(propertyValue, child, types)
		}
		return renamed
	default:
		return value
	}
}
