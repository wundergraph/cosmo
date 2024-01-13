package epoller

import (
	"errors"
	"io"
	"log"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPoller(t *testing.T) {
	// connections
	num := 10
	// msg per connection
	msgPerConn := 10

	poller, err := NewPoller(0)
	require.NoError(t, err)

	// start server
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}

			poller.Add(conn)
		}
	}()

	// create num connections and send msgPerConn messages per connection
	for i := 0; i < num; i++ {
		go func() {
			conn, err := net.Dial("tcp", ln.Addr().String())
			if err != nil {
				t.Error(err)
				return
			}
			time.Sleep(time.Second)
			for i := 0; i < msgPerConn; i++ {
				n, err := conn.Write([]byte("hello world"))
				if err != nil {
					t.Error(err)
				}
				if n != len("hello world") {
					t.Errorf("expect to write %d bytes but got %d bytes", len("hello world"), n)
				}
			}
			conn.Close()
		}()
	}

	// read those num * msgPerConn messages, and each message (hello world) contains 11 bytes.
	done := make(chan struct{})
	errs := make(chan error)
	var total int
	var count int

	expected := num * msgPerConn * len("hello world")
	go func(errs chan error) {
		for {
			conns, err := poller.Wait(128)
			if err != nil {
				t.Log(err)
				errs <- err // fatal errors (i.e t.Fatal()) must be reported in the main test goroutine
				return
			}
			if len(conns) == 0 {
				continue
			}
			count++
			buf := make([]byte, 1024)
			for _, conn := range conns {
				n, err := conn.Read(buf)
				if err != nil {
					if err == io.EOF || errors.Is(err, net.ErrClosed) {
						poller.Remove(conn)
						conn.Close()
					} else {
						t.Error(err)
					}
				}
				total += n
			}

			if total == expected {
				break
			}
		}

		t.Logf("read all %d bytes, count: %d", total, count)
		close(done)
	}(errs)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
	case err := <-errs:
		t.Fatal(err)
	}

	if total != expected {
		t.Fatalf("epoller does not work. expect %d bytes but got %d bytes", expected, total)
	}
}

type netPoller struct {
	Poller   Poller
	WriteReq chan uint64
}

func TestPoller_growstack(t *testing.T) {
	var nps []netPoller
	for i := 0; i < 2; i++ {
		poller, err := NewPoller(128)
		if err != nil {
			t.Fatal(err)
		}
		if err != nil {
			t.Fatal(err)
		}
		// the following line cause goroutine stack grow and copy local variables to new allocated stack and switch to new stack
		// but runtime.adjustpointers will check whether pointers bigger than runtime.minLegalPointer(4096) or throw a panic
		// fatal error: invalid pointer found on stack (runtime/stack.go:599@go1.14.3)
		// since NewEpoller return A pointer created by CreateIoCompletionPort may less than 4096
		np := netPoller{
			Poller:   poller,
			WriteReq: make(chan uint64, 1000000),
		}

		nps = append(nps, np)
	}

	poller := nps[0].Poller
	// start server
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}

			poller.Add(conn)
		}
	}()

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Error(err)
		return
	}
	time.Sleep(200 * time.Millisecond)
	for i := 0; i < 100; i++ {
		conn.Write([]byte("hello world"))
	}
	conn.Close()
}
