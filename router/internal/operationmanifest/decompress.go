package operationmanifest

import (
	"io"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
)

// decompressAndRead reads the full content from a reader, decompressing
// based on the file extension (.gz, .zst). Plain content is read as-is.
func decompressAndRead(r io.Reader, objectPath string) ([]byte, error) {
	var reader io.Reader

	switch strings.ToLower(filepath.Ext(objectPath)) {
	case ".gz":
		gr, err := gzip.NewReader(r)
		if err != nil {
			return nil, err
		}
		defer func() {
			_ = gr.Close()
		}()
		reader = gr
	case ".zst":
		zr, err := zstd.NewReader(r)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		reader = zr
	default:
		reader = r
	}

	return io.ReadAll(reader)
}
