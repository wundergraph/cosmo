// Polyfill for crypto.randomUUID
// crypto.randomUUID() is now standard on all modern browsers and JS runtimes.
// However, because new browser APIs are restricted to secure contexts,
// this method is only available to pages served locally (localhost or 127.0.0.1) or over HTTPS.
// This polyfill is a fallback for when crypto.randomUUID is not available.
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues
if (!('randomUUID' in crypto)) {
  // https://stackoverflow.com/a/2117523/2800218
  // @ts-ignore-next-line
  crypto.randomUUID = (): string => {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    );
  };
}
