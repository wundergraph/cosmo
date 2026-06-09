package sandbox

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/fastschema/qjs"
)

func normalizeError(ctx *qjs.Context, errValue *qjs.Value, sourceMap []byte, program string) (*ErrorEnvelope, error) {
	global := ctx.Global()
	normalizer := global.GetPropertyStr("__codemodeNormalizeErrorJSON")
	encoded, err := ctx.Invoke(normalizer, global, errValue)
	if err != nil {
		return nil, err
	}

	var envelope ErrorEnvelope
	if err := json.Unmarshal([]byte(encoded.String()), &envelope); err != nil {
		return nil, err
	}
	envelope.Stack = rewriteStack(envelope.Stack, sourceMap, userCodeStartLine(program))
	rewriteCauseStacks(envelope.Cause, sourceMap, program)
	return &envelope, nil
}

var toolsCallRE = regexp.MustCompile(`tools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(`)

func missingToolName(source string, known []string) string {
	knownSet := map[string]struct{}{}
	for _, name := range known {
		knownSet[name] = struct{}{}
	}
	for _, match := range toolsCallRE.FindAllStringSubmatch(source, -1) {
		if len(match) != 2 {
			continue
		}
		if _, ok := knownSet[match[1]]; !ok {
			return match[1]
		}
	}
	return ""
}

func rewriteCauseStacks(err *ErrorEnvelope, sourceMap []byte, program string) {
	for err != nil {
		err.Stack = rewriteStack(err.Stack, sourceMap, userCodeStartLine(program))
		err = err.Cause
	}
}

var stackLocationRE = regexp.MustCompile(`(?:\w+\.js:)?(\d+):(\d+)`)

func rewriteStack(stack string, sourceMap []byte, userStartLine int) string {
	if len(sourceMap) == 0 || stack == "" {
		return stack
	}
	sm, err := parseSourceMap(sourceMap)
	if err != nil {
		return stack
	}
	return stackLocationRE.ReplaceAllStringFunc(stack, func(match string) string {
		parts := stackLocationRE.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		line, err := strconv.Atoi(parts[1])
		if err != nil {
			return match
		}
		col, err := strconv.Atoi(parts[2])
		if err != nil {
			return match
		}
		generatedLine := line - userStartLine + 1
		if generatedLine < 1 {
			return match
		}
		mapped, ok := sm.lookup(generatedLine, col)
		if !ok {
			return match
		}
		prefix := strings.TrimSuffix(match, parts[1]+":"+parts[2])
		return prefix + mapped.source + ":" + strconv.Itoa(mapped.line) + ":" + strconv.Itoa(mapped.column)
	})
}

type sourceMap struct {
	lines [][]mapping
}

type mapping struct {
	generatedColumn int
	source          string
	line            int
	column          int
}

func parseSourceMap(data []byte) (*sourceMap, error) {
	var raw struct {
		Sources  []string `json:"sources"`
		Mappings string   `json:"mappings"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	sm := &sourceMap{lines: make([][]mapping, 0)}
	var sourceIndex, originalLine, originalColumn int
	for _, lineMappings := range strings.Split(raw.Mappings, ";") {
		var generatedColumn int
		line := make([]mapping, 0)
		for _, segment := range strings.Split(lineMappings, ",") {
			if segment == "" {
				continue
			}
			values, err := decodeVLQSegment(segment)
			if err != nil {
				return nil, err
			}
			if len(values) < 4 {
				continue
			}
			generatedColumn += values[0]
			sourceIndex += values[1]
			originalLine += values[2]
			originalColumn += values[3]
			if sourceIndex >= 0 && sourceIndex < len(raw.Sources) {
				line = append(line, mapping{
					generatedColumn: generatedColumn,
					source:          raw.Sources[sourceIndex],
					line:            originalLine + 1,
					column:          originalColumn + 1,
				})
			}
		}
		sm.lines = append(sm.lines, line)
	}
	return sm, nil
}

func (sm *sourceMap) lookup(generatedLine, generatedColumn int) (mapping, bool) {
	if generatedLine < 1 || generatedLine > len(sm.lines) {
		return mapping{}, false
	}
	line := sm.lines[generatedLine-1]
	if len(line) == 0 {
		return mapping{}, false
	}
	column0 := generatedColumn - 1
	best := line[0]
	for _, candidate := range line {
		if candidate.generatedColumn > column0 {
			break
		}
		best = candidate
	}
	return best, true
}

const vlqBaseShift = 5
const vlqBase = 1 << vlqBaseShift
const vlqBaseMask = vlqBase - 1
const vlqContinuationBit = vlqBase

var base64VLQ = map[rune]int{
	'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7,
	'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15,
	'Q': 16, 'R': 17, 'S': 18, 'T': 19, 'U': 20, 'V': 21, 'W': 22, 'X': 23,
	'Y': 24, 'Z': 25, 'a': 26, 'b': 27, 'c': 28, 'd': 29, 'e': 30, 'f': 31,
	'g': 32, 'h': 33, 'i': 34, 'j': 35, 'k': 36, 'l': 37, 'm': 38, 'n': 39,
	'o': 40, 'p': 41, 'q': 42, 'r': 43, 's': 44, 't': 45, 'u': 46, 'v': 47,
	'w': 48, 'x': 49, 'y': 50, 'z': 51, '0': 52, '1': 53, '2': 54, '3': 55,
	'4': 56, '5': 57, '6': 58, '7': 59, '8': 60, '9': 61, '+': 62, '/': 63,
}

func decodeVLQSegment(segment string) ([]int, error) {
	values := make([]int, 0, 4)
	var value, shift int
	for _, r := range segment {
		digit := base64VLQ[r]
		continuation := digit&vlqContinuationBit != 0
		digit &= vlqBaseMask
		value += digit << shift
		if continuation {
			shift += vlqBaseShift
			continue
		}
		negative := value&1 == 1
		value >>= 1
		if negative {
			value = -value
		}
		values = append(values, value)
		value = 0
		shift = 0
	}
	return values, nil
}
