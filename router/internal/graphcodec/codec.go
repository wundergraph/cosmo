// Package graphcodec serializes Go object graphs so they can be handed to another
// process running the same binary.
//
// It exists for values whose types we don't own and which were never designed to be
// serialized, such as the query plans produced by the engine. Instead of maintaining a
// hand-written mirror of every type, the codec walks values with reflection and is
// strict about everything it can't faithfully reproduce:
//
//   - unexported struct fields must hold their zero value
//   - func fields must be nil
//   - interface values must hold a registered concrete type
//
// Anything else is rejected with an *UnsupportedError rather than silently dropped, so
// a caller can fall back to producing the value locally. Pointer identity (including
// cycles) and the nil/empty distinction of slices and maps are preserved.
//
// The wire format carries no type or field names. Both sides must be built from the
// same type definitions, which they can verify by comparing Codec.Fingerprint.
package graphcodec

import (
	"cmp"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"
)

// UnsupportedError reports a value that can't be transferred without losing information.
type UnsupportedError struct {
	// Path is the location of the offending value, starting at the root.
	Path   string
	Reason string
}

func (e *UnsupportedError) Error() string {
	if e.Path == "" {
		return "graphcodec: " + e.Reason
	}
	return fmt.Sprintf("graphcodec: %s: %s", e.Path, e.Reason)
}

// ErrCorrupt is returned by Unmarshal when the input is not a valid encoding.
var ErrCorrupt = errors.New("graphcodec: corrupt input")

// Builder collects the type information a Codec needs.
type Builder struct {
	types   []reflect.Type
	omitted map[reflect.Type]func(any) error
}

func NewBuilder() *Builder {
	return &Builder{omitted: make(map[reflect.Type]func(any) error)}
}

// Register makes the dynamic types of the given values transferable inside interface
// values. Pass the values the way they are stored in the interface, typically pointers.
func (b *Builder) Register(values ...any) *Builder {
	for _, v := range values {
		b.types = append(b.types, reflect.TypeOf(v))
	}
	return b
}

// OmitInterface excludes all values of the interface type I from the encoding. Fields of
// that type decode to nil and have to be restored by the receiver. The validate function
// is called for every non-nil value that is left out and can reject values the receiver
// would not be able to restore. Unmarshal reports how many values were left out, so that
// the receiver can make sure it restored all of them.
func OmitInterface[I any](b *Builder, validate func(I) error) *Builder {
	b.omitted[reflect.TypeFor[I]()] = func(v any) error {
		return validate(v.(I))
	}
	return b
}

// Build creates the codec. The root types are only used for the fingerprint.
func (b *Builder) Build(roots ...reflect.Type) *Codec {
	c := &Codec{
		types:   slices.Clone(b.types),
		typeIDs: make(map[reflect.Type]uint64, len(b.types)),
		omitted: b.omitted,
	}
	// The type ID is the position in the sorted list, so that it doesn't depend on
	// the registration order.
	slices.SortFunc(c.types, func(x, y reflect.Type) int {
		return cmp.Compare(typeName(x), typeName(y))
	})
	c.types = slices.Compact(c.types)
	for i, t := range c.types {
		c.typeIDs[t] = uint64(i)
	}
	c.fingerprint = c.computeFingerprint(roots)
	return c
}

// Codec encodes and decodes object graphs. It is safe for concurrent use.
type Codec struct {
	types       []reflect.Type
	typeIDs     map[reflect.Type]uint64
	omitted     map[reflect.Type]func(any) error
	fingerprint string
}

// Fingerprint identifies the layout of all types the codec can transfer. Two processes
// can only exchange data if their fingerprints are equal.
func (c *Codec) Fingerprint() string {
	return c.fingerprint
}

// Marshal encodes the value v points to.
func (c *Codec) Marshal(v any) ([]byte, error) {
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Pointer || rv.IsNil() {
		return nil, errors.New("graphcodec: Marshal requires a non-nil pointer")
	}
	e := &encoder{c: c, pointers: make(map[pointerKey]uint64)}
	if err := e.encode(rv.Elem()); err != nil {
		return nil, err
	}
	return binary.AppendUvarint(e.buf, e.omitted), nil
}

// Unmarshal decodes data into the value v points to. It returns the number of non-nil
// interface values that Marshal left out because of OmitInterface. They are nil in v.
func (c *Codec) Unmarshal(data []byte, v any) (omitted int, err error) {
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Pointer || rv.IsNil() {
		return 0, errors.New("graphcodec: Unmarshal requires a non-nil pointer")
	}
	d := &decoder{c: c, buf: data}
	if err := d.decode(rv.Elem()); err != nil {
		return 0, err
	}
	count, err := d.uvarint()
	if err != nil {
		return 0, err
	}
	if len(d.buf) != 0 {
		return 0, fmt.Errorf("%w: %d trailing bytes", ErrCorrupt, len(d.buf))
	}
	if count > math.MaxInt32 {
		return 0, ErrCorrupt
	}
	return int(count), nil
}

const (
	pointerNil byte = iota
	pointerSeen
	pointerNew
)

type pointerKey struct {
	addr uintptr
	// The type is part of the key because a struct and its first field share an address.
	typ reflect.Type
}

type encoder struct {
	c        *Codec
	buf      []byte
	pointers map[pointerKey]uint64
	path     []string
	// omitted counts the non-nil values left out because of OmitInterface.
	omitted uint64
}

func (e *encoder) unsupported(format string, args ...any) error {
	return &UnsupportedError{
		Path:   strings.Join(e.path, ""),
		Reason: fmt.Sprintf(format, args...),
	}
}

func (e *encoder) encode(v reflect.Value) error {
	switch v.Kind() {
	case reflect.Bool:
		if v.Bool() {
			e.buf = append(e.buf, 1)
		} else {
			e.buf = append(e.buf, 0)
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		e.buf = binary.AppendVarint(e.buf, v.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		e.buf = binary.AppendUvarint(e.buf, v.Uint())
	case reflect.Float32, reflect.Float64:
		e.buf = binary.BigEndian.AppendUint64(e.buf, math.Float64bits(v.Float()))
	case reflect.String:
		e.buf = binary.AppendUvarint(e.buf, uint64(v.Len()))
		e.buf = append(e.buf, v.String()...)
	case reflect.Slice:
		return e.encodeSlice(v)
	case reflect.Array:
		for i := range v.Len() {
			if err := e.encodeElem(v.Index(i), i); err != nil {
				return err
			}
		}
	case reflect.Map:
		return e.encodeMap(v)
	case reflect.Struct:
		return e.encodeStruct(v)
	case reflect.Pointer:
		return e.encodePointer(v)
	case reflect.Interface:
		return e.encodeInterface(v)
	case reflect.Func:
		if !v.IsNil() {
			return e.unsupported("func values can't be transferred")
		}
	default:
		return e.unsupported("values of kind %s can't be transferred", v.Kind())
	}
	return nil
}

func (e *encoder) encodeElem(v reflect.Value, index int) error {
	e.path = append(e.path, fmt.Sprintf("[%d]", index))
	err := e.encode(v)
	e.path = e.path[:len(e.path)-1]
	return err
}

func (e *encoder) encodeSlice(v reflect.Value) error {
	if v.IsNil() {
		e.buf = binary.AppendUvarint(e.buf, 0)
		return nil
	}
	e.buf = binary.AppendUvarint(e.buf, uint64(v.Len())+1)
	if v.Type().Elem().Kind() == reflect.Uint8 {
		e.buf = append(e.buf, v.Bytes()...)
		return nil
	}
	for i := range v.Len() {
		if err := e.encodeElem(v.Index(i), i); err != nil {
			return err
		}
	}
	return nil
}

func (e *encoder) encodeMap(v reflect.Value) error {
	if v.IsNil() {
		e.buf = binary.AppendUvarint(e.buf, 0)
		return nil
	}
	compare, err := mapKeyCompare(v.Type().Key())
	if err != nil {
		return e.unsupported("%s", err)
	}
	e.buf = binary.AppendUvarint(e.buf, uint64(v.Len())+1)
	// Sorted, so that equal maps produce equal bytes.
	keys := v.MapKeys()
	slices.SortFunc(keys, compare)
	for _, key := range keys {
		if err := e.encode(key); err != nil {
			return err
		}
		e.path = append(e.path, fmt.Sprintf("[%v]", key))
		err := e.encode(v.MapIndex(key))
		e.path = e.path[:len(e.path)-1]
		if err != nil {
			return err
		}
	}
	return nil
}

func mapKeyCompare(key reflect.Type) (func(x, y reflect.Value) int, error) {
	switch key.Kind() {
	case reflect.String:
		return func(x, y reflect.Value) int { return cmp.Compare(x.String(), y.String()) }, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return func(x, y reflect.Value) int { return cmp.Compare(x.Int(), y.Int()) }, nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return func(x, y reflect.Value) int { return cmp.Compare(x.Uint(), y.Uint()) }, nil
	}
	return nil, fmt.Errorf("maps with keys of kind %s can't be transferred", key.Kind())
}

func (e *encoder) encodeStruct(v reflect.Value) error {
	t := v.Type()
	for i := range t.NumField() {
		field := t.Field(i)
		if !field.IsExported() {
			// We can neither read nor restore unexported state. That is only safe when
			// there is none, which is what a zero value means for all types we transfer.
			if !v.Field(i).IsZero() {
				return e.unsupported("%s has state in the unexported field %q", t, field.Name)
			}
			continue
		}
		e.path = append(e.path, "."+field.Name)
		err := e.encode(v.Field(i))
		e.path = e.path[:len(e.path)-1]
		if err != nil {
			return err
		}
	}
	return nil
}

func (e *encoder) encodePointer(v reflect.Value) error {
	if v.IsNil() {
		e.buf = append(e.buf, pointerNil)
		return nil
	}
	key := pointerKey{addr: v.Pointer(), typ: v.Type()}
	if id, ok := e.pointers[key]; ok {
		e.buf = append(e.buf, pointerSeen)
		e.buf = binary.AppendUvarint(e.buf, id)
		return nil
	}
	// The ID has to be assigned before encoding the target to support cycles.
	e.pointers[key] = uint64(len(e.pointers))
	e.buf = append(e.buf, pointerNew)
	return e.encode(v.Elem())
}

func (e *encoder) encodeInterface(v reflect.Value) error {
	if validate, ok := e.c.omitted[v.Type()]; ok {
		if v.IsNil() {
			return nil
		}
		if err := validate(v.Interface()); err != nil {
			return e.unsupported("%s", err)
		}
		e.omitted++
		return nil
	}
	if v.IsNil() {
		e.buf = binary.AppendUvarint(e.buf, 0)
		return nil
	}
	concrete := v.Elem()
	id, ok := e.c.typeIDs[concrete.Type()]
	if !ok {
		return e.unsupported("%s values can't be transferred as %s", concrete.Type(), v.Type())
	}
	e.buf = binary.AppendUvarint(e.buf, id+1)
	return e.encode(concrete)
}

type decoder struct {
	c        *Codec
	buf      []byte
	pointers []reflect.Value
}

func (d *decoder) uvarint() (uint64, error) {
	v, n := binary.Uvarint(d.buf)
	if n <= 0 {
		return 0, ErrCorrupt
	}
	d.buf = d.buf[n:]
	return v, nil
}

func (d *decoder) byte() (byte, error) {
	if len(d.buf) == 0 {
		return 0, ErrCorrupt
	}
	b := d.buf[0]
	d.buf = d.buf[1:]
	return b, nil
}

// length reads the length of a slice or map. A nil value is reported as ok == false.
func (d *decoder) length(elem reflect.Type) (n int, ok bool, err error) {
	raw, err := d.uvarint()
	if err != nil {
		return 0, false, err
	}
	if raw == 0 {
		return 0, false, nil
	}
	raw--
	// Every element takes at least one byte, unless it has nothing to encode at all.
	// This keeps a corrupt length from triggering a huge allocation.
	if raw > uint64(len(d.buf)) && (raw > math.MaxInt32 || !d.c.encodesToNothing(elem, 0)) {
		return 0, false, ErrCorrupt
	}
	return int(raw), true, nil
}

func (d *decoder) decode(v reflect.Value) error {
	switch v.Kind() {
	case reflect.Bool:
		b, err := d.byte()
		if err != nil {
			return err
		}
		v.SetBool(b != 0)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		i, n := binary.Varint(d.buf)
		if n <= 0 || v.OverflowInt(i) {
			return ErrCorrupt
		}
		d.buf = d.buf[n:]
		v.SetInt(i)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		u, err := d.uvarint()
		if err != nil {
			return err
		}
		if v.OverflowUint(u) {
			return ErrCorrupt
		}
		v.SetUint(u)
	case reflect.Float32, reflect.Float64:
		if len(d.buf) < 8 {
			return ErrCorrupt
		}
		v.SetFloat(math.Float64frombits(binary.BigEndian.Uint64(d.buf)))
		d.buf = d.buf[8:]
	case reflect.String:
		n, err := d.uvarint()
		if err != nil {
			return err
		}
		if n > uint64(len(d.buf)) {
			return ErrCorrupt
		}
		v.SetString(string(d.buf[:n]))
		d.buf = d.buf[n:]
	case reflect.Slice:
		return d.decodeSlice(v)
	case reflect.Array:
		for i := range v.Len() {
			if err := d.decode(v.Index(i)); err != nil {
				return err
			}
		}
	case reflect.Map:
		return d.decodeMap(v)
	case reflect.Struct:
		t := v.Type()
		for i := range t.NumField() {
			if !t.Field(i).IsExported() {
				continue
			}
			if err := d.decode(v.Field(i)); err != nil {
				return err
			}
		}
	case reflect.Pointer:
		return d.decodePointer(v)
	case reflect.Interface:
		return d.decodeInterface(v)
	case reflect.Func:
		// Only nil funcs are encoded, and they take no space.
	default:
		return fmt.Errorf("graphcodec: values of kind %s can't be transferred", v.Kind())
	}
	return nil
}

func (d *decoder) decodeSlice(v reflect.Value) error {
	t := v.Type()
	n, ok, err := d.length(t.Elem())
	if err != nil {
		return err
	}
	if !ok {
		v.SetZero()
		return nil
	}
	if t.Elem().Kind() == reflect.Uint8 {
		if n > len(d.buf) {
			return ErrCorrupt
		}
		out := reflect.MakeSlice(t, n, n)
		reflect.Copy(out, reflect.ValueOf(d.buf[:n]))
		d.buf = d.buf[n:]
		v.Set(out)
		return nil
	}
	out := reflect.MakeSlice(t, n, n)
	for i := range n {
		if err := d.decode(out.Index(i)); err != nil {
			return err
		}
	}
	v.Set(out)
	return nil
}

func (d *decoder) decodeMap(v reflect.Value) error {
	t := v.Type()
	n, ok, err := d.length(t.Key())
	if err != nil {
		return err
	}
	if !ok {
		v.SetZero()
		return nil
	}
	out := reflect.MakeMapWithSize(t, n)
	for range n {
		key := reflect.New(t.Key()).Elem()
		if err := d.decode(key); err != nil {
			return err
		}
		value := reflect.New(t.Elem()).Elem()
		if err := d.decode(value); err != nil {
			return err
		}
		out.SetMapIndex(key, value)
	}
	v.Set(out)
	return nil
}

func (d *decoder) decodePointer(v reflect.Value) error {
	tag, err := d.byte()
	if err != nil {
		return err
	}
	switch tag {
	case pointerNil:
		v.SetZero()
		return nil
	case pointerSeen:
		id, err := d.uvarint()
		if err != nil {
			return err
		}
		if id >= uint64(len(d.pointers)) || d.pointers[id].Type() != v.Type() {
			return ErrCorrupt
		}
		v.Set(d.pointers[id])
		return nil
	case pointerNew:
		target := reflect.New(v.Type().Elem())
		// Registered before decoding the target, mirroring the encoder, to support cycles.
		d.pointers = append(d.pointers, target)
		v.Set(target)
		return d.decode(target.Elem())
	}
	return ErrCorrupt
}

func (d *decoder) decodeInterface(v reflect.Value) error {
	if _, ok := d.c.omitted[v.Type()]; ok {
		return nil
	}
	id, err := d.uvarint()
	if err != nil {
		return err
	}
	if id == 0 {
		v.SetZero()
		return nil
	}
	id--
	if id >= uint64(len(d.c.types)) {
		return ErrCorrupt
	}
	concreteType := d.c.types[id]
	if !concreteType.AssignableTo(v.Type()) {
		return ErrCorrupt
	}
	concrete := reflect.New(concreteType).Elem()
	if err := d.decode(concrete); err != nil {
		return err
	}
	v.Set(concrete)
	return nil
}

// encodesToNothing reports whether values of type t never occupy any bytes.
func (c *Codec) encodesToNothing(t reflect.Type, depth int) bool {
	if depth > 16 {
		return false
	}
	switch t.Kind() {
	case reflect.Func:
		return true
	case reflect.Interface:
		_, omitted := c.omitted[t]
		return omitted
	case reflect.Array:
		return t.Len() == 0 || c.encodesToNothing(t.Elem(), depth+1)
	case reflect.Struct:
		for i := range t.NumField() {
			if field := t.Field(i); field.IsExported() && !c.encodesToNothing(field.Type, depth+1) {
				return false
			}
		}
		return true
	}
	return false
}

func typeName(t reflect.Type) string {
	if t.PkgPath() != "" {
		return t.PkgPath() + "." + t.Name()
	}
	return t.String()
}

func (c *Codec) computeFingerprint(roots []reflect.Type) string {
	var (
		out     strings.Builder
		visited = make(map[reflect.Type]struct{})
		visit   func(t reflect.Type)
	)
	visit = func(t reflect.Type) {
		if _, ok := visited[t]; ok {
			return
		}
		visited[t] = struct{}{}
		fmt.Fprintf(&out, "%s %s", t.Kind(), typeName(t))
		if _, omitted := c.omitted[t]; omitted {
			out.WriteString(" omitted")
		}
		switch t.Kind() {
		case reflect.Struct:
			out.WriteString(" {")
			for i := range t.NumField() {
				field := t.Field(i)
				fmt.Fprintf(&out, " %s:%s:%t", field.Name, field.Type, field.IsExported())
			}
			out.WriteString(" }\n")
			for i := range t.NumField() {
				if field := t.Field(i); field.IsExported() {
					visit(field.Type)
				}
			}
			return
		case reflect.Map:
			out.WriteString("\n")
			visit(t.Key())
			visit(t.Elem())
			return
		case reflect.Pointer, reflect.Slice, reflect.Array:
			out.WriteString("\n")
			visit(t.Elem())
			return
		}
		out.WriteString("\n")
	}
	for _, t := range roots {
		visit(t)
	}
	// In type ID order, because the IDs are part of the wire format.
	for _, t := range c.types {
		visit(t)
	}
	sum := sha256.Sum256([]byte(out.String()))
	return hex.EncodeToString(sum[:16])
}
