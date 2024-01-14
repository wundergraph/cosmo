package epoller

import (
	"net"
	"reflect"
	"runtime"
	"syscall"
	"testing"
)

func reflectSocketFDAsUint(conn net.Conn) uint64 {
	tcpConn := reflect.Indirect(reflect.ValueOf(conn)).FieldByName("conn")
	fdVal := tcpConn.FieldByName("fd")
	pfdVal := reflect.Indirect(fdVal).FieldByName("pfd")

	return pfdVal.FieldByName("Sysfd").Uint()
}

func rawSocketFD(conn net.Conn) uint64 {
	if con, ok := conn.(syscall.Conn); ok {
		raw, err := con.SyscallConn()
		if err != nil {
			return 0
		}
		sfd := uint64(0)
		raw.Control(func(fd uintptr) {
			sfd = uint64(fd)
		})
		return sfd
	}
	return 0
}

func BenchmarkSocketFdReflect(b *testing.B) {
	var con, _ = net.Dial(`udp`, "8.8.8.8:53")
	fd := uint64(0)
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		fd = reflectSocketFDAsUint(con)
	}
	runtime.KeepAlive(fd)
}

func BenchmarkSocketFdRaw(b *testing.B) {
	con, _ := net.Dial(`udp`, "8.8.8.8:53")
	fd := uint64(0)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		fd = rawSocketFD(con)
	}
	runtime.KeepAlive(fd)
}
