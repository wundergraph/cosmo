function BigInt(value) {
    return value;
}

class URL {
    constructor(url, base) {
        // urlParse is provided by the runtime
        const result = urlParse(url, base || '');
        for (const prop in result) {
            this[prop] = result[prop]
        }
    }
}
