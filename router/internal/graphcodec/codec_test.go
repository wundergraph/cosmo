package graphcodec

import (
	"errors"
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

type shape interface {
	Area() int
}

type square struct {
	Side int
}

func (s *square) Area() int { return s.Side * s.Side }

type group struct {
	Name     string
	Members  []shape
	Parent   *group
	Children []*group
}

func (g *group) Area() int { return 0 }

type circle struct {
	Radius int
}

func (c *circle) Area() int { return 3 * c.Radius * c.Radius }

type handle interface {
	Close() error
}

type fileHandle struct {
	fd int
}

func (f *fileHandle) Close() error { return nil }

type socketHandle struct{}

func (s *socketHandle) Close() error { return nil }

type everything struct {
	Bool       bool
	Int        int
	Int8       int8
	Uint64     uint64
	Float      float64
	Float32    float32
	String     string
	Bytes      []byte
	NilBytes   []byte
	EmptyBytes []byte
	Strings    []string
	NilSlice   []string
	EmptySlice []string
	Array      [3]uint16
	Set        map[string]struct{}
	NilMap     map[string]int
	EmptyMap   map[string]int
	ByNumber   map[int]string
	Pointer    *square
	NilPointer *square
	Shape      shape
	NilShape   shape
	Nested     struct {
		Values [][]byte
	}
	Callback func()
}

func newTestCodec() *Codec {
	b := NewBuilder().Register(&square{}, &group{})
	OmitInterface(b, func(h handle) error {
		if _, ok := h.(*fileHandle); ok {
			return nil
		}
		return errors.New("only files can be restored")
	})
	return b.Build(reflect.TypeFor[everything](), reflect.TypeFor[group]())
}

func TestRoundTrip(t *testing.T) {
	t.Parallel()

	codec := newTestCodec()

	in := everything{
		Bool:       true,
		Int:        -42,
		Int8:       -128,
		Uint64:     1 << 63,
		Float:      3.25,
		Float32:    1.5,
		String:     "héllo",
		Bytes:      []byte{0, 1, 2},
		EmptyBytes: []byte{},
		Strings:    []string{"a", "", "c"},
		EmptySlice: []string{},
		Array:      [3]uint16{1, 2, 3},
		Set:        map[string]struct{}{"a": {}, "b": {}},
		EmptyMap:   map[string]int{},
		ByNumber:   map[int]string{-1: "minus one", 7: "seven"},
		Pointer:    &square{Side: 2},
		Shape:      &square{Side: 3},
	}
	in.Nested.Values = [][]byte{nil, {}, {1}}

	data, err := codec.Marshal(&in)
	require.NoError(t, err)

	var out everything
	_, err = codec.Unmarshal(data, &out)
	require.NoError(t, err)
	require.Equal(t, in, out)

	// nil and empty are different values, and stay different.
	require.Nil(t, out.NilBytes)
	require.NotNil(t, out.EmptyBytes)
	require.Nil(t, out.NilSlice)
	require.NotNil(t, out.EmptySlice)
	require.Nil(t, out.NilMap)
	require.NotNil(t, out.EmptyMap)

	again, err := codec.Marshal(&out)
	require.NoError(t, err)
	require.Equal(t, data, again, "equal values must encode to equal bytes")
}

func TestPointerIdentityAndCycles(t *testing.T) {
	t.Parallel()

	codec := newTestCodec()

	shared := &square{Side: 5}
	root := &group{Name: "root", Members: []shape{shared, shared}}
	child := &group{Name: "child", Parent: root, Members: []shape{shared, root}}
	root.Children = []*group{child, child}

	data, err := codec.Marshal(&root)
	require.NoError(t, err)

	var out *group
	_, err = codec.Unmarshal(data, &out)
	require.NoError(t, err)

	require.Equal(t, "root", out.Name)
	require.Len(t, out.Children, 2)
	require.Same(t, out.Children[0], out.Children[1])
	require.Same(t, out, out.Children[0].Parent, "the cycle must lead back to the same value")
	require.Same(t, out.Members[0], out.Members[1])
	require.Same(t, out.Members[0], out.Children[0].Members[0])
	require.Same(t, out, out.Children[0].Members[1], "identity must hold across interface values")
}

func TestOmittedInterface(t *testing.T) {
	t.Parallel()

	type resource struct {
		Name   string
		Handle handle
		After  string
	}

	codec := newTestCodec()

	t.Run("is left out and decodes to nil", func(t *testing.T) {
		data, err := codec.Marshal(&resource{Name: "a", Handle: &fileHandle{fd: 3}, After: "z"})
		require.NoError(t, err)

		var out resource
		omitted, err := codec.Unmarshal(data, &out)
		require.NoError(t, err)
		require.Equal(t, resource{Name: "a", After: "z"}, out)
		require.Equal(t, 1, omitted)
	})

	t.Run("is counted", func(t *testing.T) {
		shared := &resource{Name: "shared", Handle: &fileHandle{}}
		in := []*resource{
			{Name: "a", Handle: &fileHandle{}},
			{Name: "nil"},
			shared,
			// The same value again is not another handle to restore.
			shared,
		}
		data, err := codec.Marshal(&in)
		require.NoError(t, err)

		var out []*resource
		omitted, err := codec.Unmarshal(data, &out)
		require.NoError(t, err)
		require.Len(t, out, 4)
		require.Equal(t, 2, omitted)
	})

	t.Run("is validated", func(t *testing.T) {
		_, err := codec.Marshal(&resource{Name: "a", Handle: &socketHandle{}})
		var unsupported *UnsupportedError
		require.ErrorAs(t, err, &unsupported)
		require.Equal(t, ".Handle", unsupported.Path)
		require.Equal(t, "only files can be restored", unsupported.Reason)
	})
}

func TestRejectsWhatCannotBeReproduced(t *testing.T) {
	t.Parallel()

	codec := newTestCodec()

	requireUnsupported := func(t *testing.T, v any, path string) {
		t.Helper()
		_, err := codec.Marshal(v)
		var unsupported *UnsupportedError
		require.ErrorAs(t, err, &unsupported)
		require.Equal(t, path, unsupported.Path)
	}

	t.Run("unregistered type in an interface", func(t *testing.T) {
		requireUnsupported(t, &everything{Shape: &circle{Radius: 1}}, ".Shape")
	})

	t.Run("func", func(t *testing.T) {
		requireUnsupported(t, &everything{Callback: func() {}}, ".Callback")
	})

	t.Run("state in an unexported field", func(t *testing.T) {
		type wrapper struct {
			Items []*fileHandle
		}
		requireUnsupported(t, &wrapper{Items: []*fileHandle{{}, {fd: 1}}}, ".Items[1]")
	})

	t.Run("unexported fields without state are fine", func(t *testing.T) {
		type wrapper struct {
			Item *fileHandle
		}
		data, err := codec.Marshal(&wrapper{Item: &fileHandle{}})
		require.NoError(t, err)

		var out wrapper
		_, err = codec.Unmarshal(data, &out)
		require.NoError(t, err)
		require.Equal(t, &fileHandle{}, out.Item)
	})

	t.Run("channel", func(t *testing.T) {
		type wrapper struct {
			Events chan int
		}
		requireUnsupported(t, &wrapper{}, ".Events")
	})
}

func TestUnmarshalRejectsCorruptInput(t *testing.T) {
	t.Parallel()

	codec := newTestCodec()

	data, err := codec.Marshal(&everything{
		String:  "hello",
		Strings: []string{"a", "b"},
		Set:     map[string]struct{}{"a": {}},
		Pointer: &square{Side: 2},
		Shape:   &square{Side: 3},
	})
	require.NoError(t, err)

	t.Run("truncated", func(t *testing.T) {
		for i := range len(data) {
			var out everything
			_, err := codec.Unmarshal(data[:i], &out)
			require.Error(t, err, "length %d", i)
		}
	})

	t.Run("trailing bytes", func(t *testing.T) {
		var out everything
		_, err := codec.Unmarshal(append(data[:len(data):len(data)], 0), &out)
		require.ErrorIs(t, err, ErrCorrupt)
	})

	t.Run("huge length", func(t *testing.T) {
		var out []string
		_, err := codec.Unmarshal([]byte{0xff, 0xff, 0xff, 0xff, 0x0f}, &out)
		require.ErrorIs(t, err, ErrCorrupt)
	})

	t.Run("unknown type", func(t *testing.T) {
		var out shape
		_, err := codec.Unmarshal([]byte{99}, &out)
		require.ErrorIs(t, err, ErrCorrupt)
	})

	t.Run("unknown pointer", func(t *testing.T) {
		var out *square
		_, err := codec.Unmarshal([]byte{pointerSeen, 0}, &out)
		require.ErrorIs(t, err, ErrCorrupt)
	})
}

func TestFingerprint(t *testing.T) {
	t.Parallel()

	type v1 struct {
		Name string
	}
	type v2 struct {
		Name  string
		Extra int
	}

	base := NewBuilder().Register(&square{}).Build(reflect.TypeFor[v1]())

	t.Run("is stable", func(t *testing.T) {
		// The order of registration must not matter.
		a := NewBuilder().Register(&square{}, &group{}).Build(reflect.TypeFor[v1]())
		b := NewBuilder().Register(&group{}, &square{}).Build(reflect.TypeFor[v1]())
		require.Equal(t, a.Fingerprint(), b.Fingerprint())
	})

	t.Run("changes with the layout of a type", func(t *testing.T) {
		other := NewBuilder().Register(&square{}).Build(reflect.TypeFor[v2]())
		require.NotEqual(t, base.Fingerprint(), other.Fingerprint())
	})

	t.Run("changes with the registered types", func(t *testing.T) {
		other := NewBuilder().Register(&square{}, &group{}).Build(reflect.TypeFor[v1]())
		require.NotEqual(t, base.Fingerprint(), other.Fingerprint())
	})
}
