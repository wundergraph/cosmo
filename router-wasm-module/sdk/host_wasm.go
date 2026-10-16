//go:build wasip1 || wasm

package sdk

import "github.com/extism/go-pdk"

// Router host function imports. Strings and byte slices cross the boundary as
// Extism memory offsets; see the Host* constants in the wire package.

//go:wasmimport extism:host/user cosmo_request_info
func hostRequestInfo() uint64

//go:wasmimport extism:host/user cosmo_header_names
func hostHeaderNames(kind int32) uint64

//go:wasmimport extism:host/user cosmo_header_values
func hostHeaderValues(kind int32, name uint64) uint64

//go:wasmimport extism:host/user cosmo_header_set
func hostHeaderSet(kind int32, name, value uint64)

//go:wasmimport extism:host/user cosmo_header_add
func hostHeaderAdd(kind int32, name, value uint64)

//go:wasmimport extism:host/user cosmo_header_del
func hostHeaderDel(kind int32, name uint64)

//go:wasmimport extism:host/user cosmo_body_read
func hostBodyRead(kind int32) uint64

//go:wasmimport extism:host/user cosmo_body_write
func hostBodyWrite(kind int32, body uint64)

//go:wasmimport extism:host/user cosmo_status_get
func hostStatusGet() int32

//go:wasmimport extism:host/user cosmo_status_set
func hostStatusSet(code int32)

//go:wasmimport extism:host/user cosmo_context_info
func hostContextInfo() uint64

//go:wasmimport extism:host/user cosmo_context_get
func hostContextGet(key uint64) uint64

//go:wasmimport extism:host/user cosmo_context_set
func hostContextSet(key, value uint64)

func init() {
	host = wasmHost{}
}

type wasmHost struct{}

// arg copies b into Extism memory for a host call. The returned free func
// releases it once the call returned. Empty values are passed as offset 0.
func arg(b []byte) (uint64, func()) {
	if len(b) == 0 {
		return 0, func() {}
	}
	mem := pdk.AllocateBytes(b)
	return mem.Offset(), mem.Free
}

func strArg(s string) (uint64, func()) {
	return arg([]byte(s))
}

// result reads and frees a host-allocated block. Offset 0 yields nil.
func result(offset uint64) []byte {
	if offset == 0 {
		return nil
	}
	mem := pdk.FindMemory(offset)
	b := mem.ReadBytes()
	mem.Free()
	return b
}

func (wasmHost) requestInfo() []byte { return result(hostRequestInfo()) }

func (wasmHost) headerNames(kind int32) []byte { return result(hostHeaderNames(kind)) }

func (wasmHost) headerValues(kind int32, name string) []byte {
	n, free := strArg(name)
	defer free()
	return result(hostHeaderValues(kind, n))
}

func (wasmHost) headerSet(kind int32, name, value string) {
	n, freeN := strArg(name)
	defer freeN()
	v, freeV := strArg(value)
	defer freeV()
	hostHeaderSet(kind, n, v)
}

func (wasmHost) headerAdd(kind int32, name, value string) {
	n, freeN := strArg(name)
	defer freeN()
	v, freeV := strArg(value)
	defer freeV()
	hostHeaderAdd(kind, n, v)
}

func (wasmHost) headerDel(kind int32, name string) {
	n, free := strArg(name)
	defer free()
	hostHeaderDel(kind, n)
}

func (wasmHost) bodyRead(kind int32) []byte { return result(hostBodyRead(kind)) }

func (wasmHost) bodyWrite(kind int32, body []byte) {
	b, free := arg(body)
	defer free()
	hostBodyWrite(kind, b)
}

func (wasmHost) statusGet() int32 { return hostStatusGet() }

func (wasmHost) statusSet(code int32) { hostStatusSet(code) }

func (wasmHost) contextInfo() []byte { return result(hostContextInfo()) }

func (wasmHost) contextGet(key string) []byte {
	k, free := strArg(key)
	defer free()
	return result(hostContextGet(k))
}

func (wasmHost) contextSet(key string, value []byte) {
	k, freeK := strArg(key)
	defer freeK()
	v, freeV := arg(value)
	defer freeV()
	hostContextSet(k, v)
}
