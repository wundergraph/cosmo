function BigInt(value) {
    return String(value);
}

// TextEncoder/TextDecoder polyfill for goja (ES6 runtime)
if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        encode(str) {
            const utf8 = unescape(encodeURIComponent(str));
            const arr = new Uint8Array(utf8.length);
            for (let i = 0; i < utf8.length; i++) {
                arr[i] = utf8.charCodeAt(i);
            }
            return arr;
        }
    };
}

if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        decode(bytes) {
            if (!bytes) return '';
            const arr = new Uint8Array(bytes);
            let str = '';
            for (let i = 0; i < arr.length; i++) {
                str += String.fromCharCode(arr[i]);
            }
            try {
                return decodeURIComponent(escape(str));
            } catch (e) {
                // Replace invalid UTF-8 sequences with U+FFFD (replacement character)
                return str.replace(/[\x80-\xff]/g, '\uFFFD');
            }
        }
    };
}

class URL {
    constructor(url, base) {
        // urlParse is provided by the runtime
        const result = urlParse(url, base || '');
        for (const prop in result) {
            this[prop] = result[prop]
        }
    }

    static canParse(url, base = undefined) {
        return urlCanParse(url, base || '');
    }
}
