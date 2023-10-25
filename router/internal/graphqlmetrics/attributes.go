package graphqlmetrics

const (
	// Please take inspiration from OTEL conventions

	// HTTPStatusCodeAttribute is the attribute name for the HTTP status code
	HTTPStatusCodeAttribute = "http.status_code"
)

type Attributes = map[string]string
