package sdk

// hostAPI is the bridge to the router host functions (see the Host* constants
// in the wire package). Byte results are nil when the host returned nothing.
// On the wasip1 target it calls the real imports (host_wasm.go); on other
// platforms every call panics, since there is no router to talk to.
type hostAPI interface {
	requestInfo() []byte
	headerNames(kind int32) []byte
	headerValues(kind int32, name string) []byte
	headerSet(kind int32, name, value string)
	headerAdd(kind int32, name, value string)
	headerDel(kind int32, name string)
	bodyRead(kind int32) []byte
	bodyWrite(kind int32, body []byte)
	statusGet() int32
	statusSet(code int32)
	contextInfo() []byte
	contextGet(key string) []byte
	contextSet(key string, value []byte)
}

var host hostAPI = unavailableHost{}

type unavailableHost struct{}

func unavailable() {
	panic("sdk: router host functions are only available when running inside the router")
}

func (unavailableHost) requestInfo() []byte               { unavailable(); return nil }
func (unavailableHost) headerNames(int32) []byte          { unavailable(); return nil }
func (unavailableHost) headerValues(int32, string) []byte { unavailable(); return nil }
func (unavailableHost) headerSet(int32, string, string)   { unavailable() }
func (unavailableHost) headerAdd(int32, string, string)   { unavailable() }
func (unavailableHost) headerDel(int32, string)           { unavailable() }
func (unavailableHost) bodyRead(int32) []byte             { unavailable(); return nil }
func (unavailableHost) bodyWrite(int32, []byte)           { unavailable() }
func (unavailableHost) statusGet() int32                  { unavailable(); return 0 }
func (unavailableHost) statusSet(int32)                   { unavailable() }
func (unavailableHost) contextInfo() []byte               { unavailable(); return nil }
func (unavailableHost) contextGet(string) []byte          { unavailable(); return nil }
func (unavailableHost) contextSet(string, []byte)         { unavailable() }
