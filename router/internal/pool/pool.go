package pool

import (
	"bytes"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/pool"
)

func GetBytesBuffer() *bytes.Buffer {
	buf := pool.BytesBuffer.Get()
	buf.Reset()
	return buf
}

func PutBytesBuffer(buf *bytes.Buffer) {
	pool.BytesBuffer.Put(buf)
}
