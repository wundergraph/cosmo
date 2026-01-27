import { describe, expect, test } from 'vitest';
import {
  extractOperationNames,
  hasLabelsChanged,
  isValidGrpcNamingScheme,
  isValidLabels,
  isValidNamespaceName,
} from './util.js';
import { organizationSlugSchema } from './constants.js';

describe('Util', (ctx) => {
  test('Should validate label', () => {
    expect(
      isValidLabels([
        {
          key: '_internal',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'val1',
        },
      ]),
    ).toBe(true);
    expect(
      isValidLabels([
        {
          key: '',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: '',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1,',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'val1,',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1*',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'a'.repeat(64),
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'a'.repeat(64),
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: '-key1',
          value: 'val1,',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: '-val1,',
        },
      ]),
    ).toBe(false);
  });
  test('Should identify if labels has changed', () => {
    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(false);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
        ],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(false);
    expect(
      hasLabelsChanged(
        [
          { key: 'key3', value: 'val3' },
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
          { key: 'key3', value: 'val3' },
        ],
      ),
    ).toBe(false);

    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1234' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1234' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val1' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key123', value: 'val1' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1234' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [{ key: 'key2', value: 'val2' }],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(true);
  });

  test('Valid organization slug', () => {
    const slugs = [
      { slug: 'acme-corp', expected: true },
      { slug: '1acme-corp2', expected: true },
      { slug: 'ac', expected: false },
      { slug: '25CharactersLong123456789', expected: true },
      { slug: 'acme-', expected: false },
      { slug: '-acme', expected: false },
      { slug: 'ac_24', expected: false },
      { slug: '1a$c', expected: false },
      { slug: '   ', expected: false },
      { slug: 'a', expected: false },
      { slug: 'a'.repeat(50), expected: false },
    ];

    for (const entry of slugs) {
      const parsed = organizationSlugSchema.safeParse(entry.slug);
      expect(parsed.success).equal(entry.expected);
    }
  });

  test('Valid namespace name', () => {
    const entries = [
      { name: 'prod-1', expected: true },
      { name: '1prod-prod2', expected: true },
      { name: 'dev', expected: true },
      { name: 'acme-', expected: false },
      { name: '-acme', expected: false },
      { name: 'ac_24', expected: true },
      { name: '1a$c', expected: false },
      { name: ' prod', expected: false },
      { name: 'prod ', expected: false },
      { name: 'prod env', expected: false },
      { name: 'prod^env', expected: false },
    ];

    for (const entry of entries) {
      expect(isValidNamespaceName(entry.name)).equal(entry.expected);
    }
  });
});

describe('extract operation names', () => {
  test('parse operations without names', () => {
    const contents = `query {
          hello
      }`;
    const operationNames = extractOperationNames(contents);
    expect(operationNames).toEqual([]);
  });
  test('parse operations with names', () => {
    const contents = `query getTaskAndUser {
          getTask(id: "0x3") {
            id
            title
            completed
          }
          queryUser(filter: {username: {eq: "john"}}) {
            username
            name
          }
        }
        
        query completedTasks {
          queryTask(filter: {completed: true}) {
            title
            completed
          }
        }
      `;

    const operationNames = extractOperationNames(contents);
    expect(operationNames).toEqual(['getTaskAndUser', 'completedTasks']);
  });
});

describe('isValidGrpcNamingScheme', () => {
  describe('DNS scheme (default and explicit)', () => {
    test('should accept plain hostname (defaults to DNS)', () => {
      expect(isValidGrpcNamingScheme('localhost')).toBe(true);
      expect(isValidGrpcNamingScheme('example.com')).toBe(true);
      expect(isValidGrpcNamingScheme('subdomain.example.com')).toBe(true);
    });

    test('should accept hostname with port (defaults to DNS)', () => {
      expect(isValidGrpcNamingScheme('localhost:8080')).toBe(true);
      expect(isValidGrpcNamingScheme('example.com:443')).toBe(true);
      expect(isValidGrpcNamingScheme('subdomain.example.com:9090')).toBe(true);
    });

    test('should accept explicit DNS scheme', () => {
      expect(isValidGrpcNamingScheme('dns:localhost')).toBe(true);
      expect(isValidGrpcNamingScheme('dns:localhost:8080')).toBe(true);
      expect(isValidGrpcNamingScheme('dns:example.com:443')).toBe(true);
      expect(isValidGrpcNamingScheme('dns://example.com:8080')).toBe(true);
    });

    test('should accept DNS with authority', () => {
      expect(isValidGrpcNamingScheme('dns://8.8.8.8/example.com:8080')).toBe(true);
    });
  });

  describe('Unix domain sockets', () => {
    test('should accept unix:path format', () => {
      expect(isValidGrpcNamingScheme('unix:/tmp/socket')).toBe(true);
      expect(isValidGrpcNamingScheme('unix:./relative/path')).toBe(true);
      expect(isValidGrpcNamingScheme('unix:socket')).toBe(true);
    });

    test('should accept unix:///absolute_path format', () => {
      expect(isValidGrpcNamingScheme('unix:///tmp/socket')).toBe(true);
      expect(isValidGrpcNamingScheme('unix:///var/run/socket')).toBe(true);
    });

    test('should reject invalid unix paths', () => {
      expect(isValidGrpcNamingScheme('unix:')).toBe(false);
      expect(isValidGrpcNamingScheme('unix:///')).toBe(false);
    });
  });

  describe('Unix abstract sockets', () => {
    test('should accept unix-abstract:abstract_path', () => {
      expect(isValidGrpcNamingScheme('unix-abstract:socket')).toBe(true);
      expect(isValidGrpcNamingScheme('unix-abstract:my-socket-name')).toBe(true);
    });

    test('should reject invalid unix-abstract paths', () => {
      expect(isValidGrpcNamingScheme('unix-abstract:')).toBe(false);
    });
  });

  describe('VSOCK', () => {
    test('should accept valid vsock:cid:port', () => {
      expect(isValidGrpcNamingScheme('vsock:1:8080')).toBe(true);
      expect(isValidGrpcNamingScheme('vsock:0:443')).toBe(true);
      expect(isValidGrpcNamingScheme('vsock:4294967295:65535')).toBe(true);
    });

    test('should reject invalid vsock formats', () => {
      expect(isValidGrpcNamingScheme('vsock:1')).toBe(false);
      expect(isValidGrpcNamingScheme('vsock:1:8080:extra')).toBe(false);
      expect(isValidGrpcNamingScheme('vsock:abc:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('vsock:1:abc')).toBe(false);
      expect(isValidGrpcNamingScheme('vsock:-1:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('vsock:1:-1')).toBe(false);
    });
  });

  describe('IPv4 addresses', () => {
    test('should accept valid ipv4:address:port', () => {
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1:8080')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv4:192.168.1.1:443')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv4:0.0.0.0:80')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv4:255.255.255.255:65535')).toBe(true);
    });

    test('should accept ipv4:address without port', () => {
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv4:192.168.1.1')).toBe(true);
    });

    test('should accept multiple IPv4 addresses', () => {
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1:8080,192.168.1.1:9090')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1,192.168.1.1:9090')).toBe(true);
    });

    test('should reject invalid IPv4 addresses', () => {
      expect(isValidGrpcNamingScheme('ipv4:256.0.0.1:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1.1:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('ipv4:localhost:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('ipv4:127.0.0.1:-1')).toBe(false);
    });
  });

  describe('IPv6 addresses', () => {
    test('should accept valid ipv6:address:port with brackets', () => {
      expect(isValidGrpcNamingScheme('ipv6:[::1]:8080')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv6:[2001:db8::1]:443')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv6:[::]:1234')).toBe(true);
    });

    test('should accept valid ipv6:address without port', () => {
      expect(isValidGrpcNamingScheme('ipv6:[::1]')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv6:[2001:db8::1]')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv6:::1')).toBe(true);
      expect(isValidGrpcNamingScheme('ipv6:2001:db8::1')).toBe(true);
    });

    test('should accept multiple IPv6 addresses', () => {
      expect(isValidGrpcNamingScheme('ipv6:[::1]:8080,[2001:db8::1]:9090')).toBe(true);
    });

    test('should reject invalid IPv6 addresses', () => {
      expect(isValidGrpcNamingScheme('ipv6:[::1]:-1')).toBe(false);
      expect(isValidGrpcNamingScheme('ipv6:invalid')).toBe(false);
    });
  });

  describe('Invalid URLs (HTTP/HTTPS)', () => {
    test('should reject HTTP URLs', () => {
      expect(isValidGrpcNamingScheme('http://localhost:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('http://example.com')).toBe(false);
      expect(isValidGrpcNamingScheme('http://example.com:8080')).toBe(false);
    });

    test('should reject HTTPS URLs', () => {
      expect(isValidGrpcNamingScheme('https://localhost:8080')).toBe(false);
      expect(isValidGrpcNamingScheme('https://example.com')).toBe(false);
      expect(isValidGrpcNamingScheme('https://example.com:443')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should reject empty strings', () => {
      expect(isValidGrpcNamingScheme('')).toBe(false);
      expect(isValidGrpcNamingScheme('   ')).toBe(false);
    });

    test('should handle whitespace', () => {
      expect(isValidGrpcNamingScheme('  localhost:8080  ')).toBe(true);
      expect(isValidGrpcNamingScheme('  dns:localhost:8080  ')).toBe(true);
    });

    test('should reject unknown schemes', () => {
      expect(isValidGrpcNamingScheme('ftp://example.com')).toBe(false);
      expect(isValidGrpcNamingScheme('ws://example.com')).toBe(false);
      expect(isValidGrpcNamingScheme('file:///path')).toBe(false);
    });

    test('should reject malformed URLs', () => {
      expect(isValidGrpcNamingScheme('://invalid')).toBe(false);
      expect(isValidGrpcNamingScheme('invalid:')).toBe(false);
    });
  });
});
