package docker

import (
	"bytes"
	"io"
)

type rewindableReader struct {
	storageBuf bytes.Buffer
	readBuf    *bytes.Reader
	body       io.ReadCloser
}

func newRewindableReader(r io.Reader) *rewindableReader {
	rc, ok := r.(io.ReadCloser)
	if !ok {
		rc = io.NopCloser(r)
	}
	return &rewindableReader{
		body: rc,
	}
}

func (r *rewindableReader) Rewind() {
	r.readBuf = bytes.NewReader(r.storageBuf.Bytes())
}

func (r *rewindableReader) Read(p []byte) (int, error) {
	if r.readBuf != nil {
		n, err := r.readBuf.Read(p)
		if n > 0 || err != io.EOF {
			return n, err
		}
		r.readBuf = nil
	}
	n, err := r.body.Read(p)
	r.storageBuf.Write(p[:n])
	return n, err
}

func (d *rewindableReader) Close() error {
	// Drain the reader before closing to buffer all the data
	_, err := io.Copy(io.Discard, d)
	if err != nil {
		return err
	}
	return d.body.Close()
}
