import { describe, expect, test } from 'vitest';
import {
  isValidLabelMatchers,
  mergeUrls,
  normalizeLabelMatchers,
  isGoogleCloudStorageUrl, sanitizeReadme, isValidLocalhostOrSecureEndpoint,
} from '../src/core/util.js';

describe('Utils', () => {
  test('isValidLabelMatchers', () => {
    expect(isValidLabelMatchers(['key1=value1'])).toBe(true);
    expect(isValidLabelMatchers(['key1=value1,key2=value2'])).toBe(true);
    expect(isValidLabelMatchers(['key1=value1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=value 1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=value.1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1'])).toBe(false);
    expect(isValidLabelMatchers(['key1='])).toBe(false);
  });

  test('normalizeLabelMatchers', () => {
    expect(normalizeLabelMatchers(['A=value,A=value', 'B=value'])).toEqual(['A=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value2,B=value', 'B=value'])).toEqual(['A=value2,B=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value,B=value', 'A=value,B=value'])).toEqual(['A=value,B=value']);
  });

  test('mergeURLS', () => {
    expect(mergeUrls('http://example.com', 'path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com', '/path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/', 'path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/', '/path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/auth', 'path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth/', 'path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth', '/path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth/', '/path')).toBe('http://example.com/auth/path');
  });

  describe('isGoogleCloudStorageUrl', () => {
    test('that true is returned when a valid Google Cloud Storage URL', () => {
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com/')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://STORAGE.GOOGLEAPIS.COM')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com/bucket-name')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://bucket-name.storage.googleapis.com/')).toBe(true);
    });

    test('that true is returned when an URL with the `gs` protocol', () => {
      expect(isGoogleCloudStorageUrl('gs://bucket-name')).toBe(true);
    });

    test('that false is returned when the URL is not a valid Google Cloud Storage URL', () => {
      expect(isGoogleCloudStorageUrl('http://minio/cosmo')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://bucket-name.s3.amazonaws.com/')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://bucket-name.s3.amazonaws.com')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com.evil.com')).toBe(false);
    });
  });

  describe('sanitizeReadme', () => {
    test('that readme is sanitized without removing any content', () => {
      const readme = `\`\`\`bash
command <arg> 2>/dev/nul
\`\`\`
<svg><title><![CDATA[</title><script>alert(1345)</script>]]></svg>
<svg><title><![CDATA[</title><script>fetch('https://example.com', { credentials: 'include' }) .then(r =>r.text()).then(t => alert(t)).catch(e => console.log(e));</script>]]></svg>`;

      const sanitized = sanitizeReadme(readme);
      expect(sanitized).toBe(`\`\`\`bash
command  2&gt;/dev/nul
\`\`\`
<svg><title>]]&gt;</title></svg>
<svg><title>]]&gt;</title></svg>`);
    });
  });

  describe('isValidLocalhostOrSecureEndpoint', () => {
    test('that false is returned when given an invalid URL', () => {
      expect(isValidLocalhostOrSecureEndpoint('<invalid value>')).toBe(false);
    });

    test('that false is returned when given an endpoint without http or https protocols', () => {
      expect(isValidLocalhostOrSecureEndpoint('wss://localhost/')).toBe(false);
    });

    test('that true is returned when the endpoint is localhost', () => {
      expect(isValidLocalhostOrSecureEndpoint('http://localhost/')).toBe(true);
      expect(isValidLocalhostOrSecureEndpoint('http://localhost:4000/')).toBe(true);
    });

    test('that a non-localhost endpoint with the protocol http return false', () => {
      expect(isValidLocalhostOrSecureEndpoint('http://example.com')).toBe(false);
    })
  });
});
