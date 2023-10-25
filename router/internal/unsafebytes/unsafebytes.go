package unsafebytes

import (
	"unsafe"
)

// BytesToString converts a byte slice to a string without a memory allocation.
func BytesToString(bytes []byte) string {
	return unsafe.String(unsafe.SliceData(bytes), len(bytes))
}

// StringToBytes converts a string to a byte slice without a memory allocation.
func StringToBytes(str string) []byte {
	if str == "" {
		return nil
	}
	return unsafe.Slice(unsafe.StringData(str), len(str))
}
