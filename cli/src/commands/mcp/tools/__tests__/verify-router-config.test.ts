import { describe, it, expect } from 'vitest';
import { validateRouterConfig } from '../verify-router-config.js';

describe('validateRouterConfig', () => {
  describe('valid configs', () => {
    it('should validate correct JSON config', () => {
      const validConfig = JSON.stringify({
        version: '1',
        listen_addr: 'localhost:8080',
        graph: {
          token: 'test-token',
        },
      });

      const result = validateRouterConfig(validConfig);
      expect(result).toMatchObject({
        isValid: true,
      });
    });

    it('should validate correct YAML config', () => {
      const validConfig = `
version: '1'
listen_addr: localhost:8080
graph:
  token: test-token
`;

      const result = validateRouterConfig(validConfig);
      expect(result).toMatchObject({
        isValid: true,
      });
    });

    it('should validate correct rate limiting config', () => {
      const validConfig = JSON.stringify({
        rate_limit: {
          enabled: true,
          storage: {
            cluster_enabled: false, // Set to true if using a Redis Cluster
            urls: ['redis://localhost:6379'],
            key_prefix: 'cosmo_rate_limit',
          },
          strategy: 'simple',
          simple_strategy: {
            rate: 100,
            burst: 200,
            period: '1s',
          },
        },
      });
      const result = validateRouterConfig(validConfig);

      expect(result).toMatchObject({
        isValid: true,
      });
    });
  });

  describe('invalid configs', () => {
    it('should reject invalid JSON', () => {
      const invalidConfig = '}';
      const result = validateRouterConfig(invalidConfig);

      expect(result).toMatchObject({
        isValid: false,
        errors: [
          {
            message: 'Invalid config format. Please provide valid JSON or YAML.',
          },
        ],
      });
    });

    it('should reject invalid YAML', () => {
      const invalidConfig = 'invalid: yaml: :';
      const result = validateRouterConfig(invalidConfig);

      expect(result).toMatchObject({
        isValid: false,
        errors: [
          {
            message: 'Invalid config format. Please provide valid JSON or YAML.',
          },
        ],
      });
    });

    it('should reject config with invalid listen_addr', () => {
      const invalidConfig = JSON.stringify({
        // listen_addr is not a string
        listen_addr: true,
      });
      const result = validateRouterConfig(invalidConfig);

      expect(result).toMatchObject({
        isValid: false,
        errors: [
          {
            instancePath: '/listen_addr',
            keyword: 'type',
            message: 'must be string',
            params: {
              type: 'string',
            },
            schemaPath: '#/properties/listen_addr/type',
          },
        ],
      });
    });

    it('should reject config with invalid rate limiting config', () => {
      const invalidConfig = JSON.stringify({
        rate_limit: {
          enabled: true,
          storage: {
            cluster_enabled: false, // Set to true if using a Redis Cluster
            urls: ['redis://localhost:6379'],
            key_prefix: 'cosmo_rate_limit',
          },
          strategy: 'complex',
          simple_strategy: {
            rate: 100,
            burst: 200,
            period: '1s',
          },
        },
      });
      const result = validateRouterConfig(invalidConfig);

      expect(result).toMatchObject({
        isValid: false,
        errors: [
          {
            instancePath: '/rate_limit/strategy',
            keyword: 'enum',
            message: 'must be equal to one of the allowed values',
            params: {
              allowedValues: ['simple'],
            },
            schemaPath: '#/properties/rate_limit/properties/strategy/enum',
          },
        ],
      });
    });
  });
});
