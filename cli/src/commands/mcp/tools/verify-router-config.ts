import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import { z } from 'zod';
import yaml from 'js-yaml';
import axios from 'axios';
import { ToolContext } from './types.js';

export interface ValidationResult {
  isValid: boolean;
  errors?: ErrorObject[] | { message: string }[] | null | undefined;
  config?: string;
}

let __validate: ValidateFunction | undefined;

const buildValidate = async () => {
  if (__validate) {
    return __validate;
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false, // Allow custom keywords
    strictSchema: false,
    logger: false,
  });
  const getSchema = await axios.get(
    'https://raw.githubusercontent.com/wundergraph/cosmo/refs/heads/main/router/pkg/config/config.schema.json',
  );
  __validate = ajv.compile(getSchema.data);
  return __validate;
};

export async function validateRouterConfig(config: string): Promise<ValidationResult> {
  let parsedConfig;

  try {
    // Try to parse as JSON
    parsedConfig = JSON.parse(config);
  } catch {
    try {
      // If JSON parsing fails, try to parse as YAML
      parsedConfig = yaml.load(config);
      if (!parsedConfig || typeof parsedConfig !== 'object') {
        return {
          isValid: false,
          errors: [
            {
              message: 'Invalid config format. Please provide valid JSON or YAML.',
            },
          ],
        };
      }
    } catch {
      return {
        isValid: false,
        errors: [
          {
            message: 'Invalid config format. Please provide valid JSON or YAML.',
          },
        ],
      };
    }
  }

  // Check if parsedConfig is null or not an object
  if (!parsedConfig || typeof parsedConfig !== 'object') {
    return {
      isValid: false,
      errors: [
        {
          message: 'Invalid config format. Please provide valid JSON or YAML.',
        },
      ],
    };
  }

  const validate = await buildValidate();
  const valid = validate(parsedConfig);

  if (!valid) {
    console.log(validate.errors);
    return {
      isValid: false,
      errors: validate.errors,
    };
  }

  return {
    isValid: true,
  };
}

export const registerVerifyRouterConfigTool = ({ server }: ToolContext) => {
  server.tool(
    'cosmo-router-config-reference',
    'Cosmo Router Configuration Reference helps you to understand how to configure the Router.',
    async () => {
      const getSchema = await axios.get(
        'https://raw.githubusercontent.com/wundergraph/cosmo/refs/heads/main/router/pkg/config/config.schema.json',
      );
      const text = `
      # Cosmo Router Configuration Reference
      
      ${JSON.stringify(getSchema.data, null, 2)}
      
      If you need further information about the router config, you can use the "search_docs" tool to search the documentation for more information about the router config.
      Ask specific questions mentioning the "router config" or "cosmo router config" keywords alongside your query.
      
      If you're proposing a new configuration, you can use the "verify_router_config" tool to validate that the configuration is valid.`;
      return {
        content: [{ type: 'text', text }],
      };
    },
  );

  server.tool(
    'verify_router_config',
    'Verify Cosmo Router Configurations. The config can be provided as JSON or YAML. This tool helps you to validate that a proposed configuration is valid.',
    {
      config: z.string().describe('The router config to verify. Can be provided as JSON or YAML.'),
    },
    async ({ config }) => {
      try {
        const result = await validateRouterConfig(config);

        if (!result.isValid) {
          const resultText = `The router config is invalid. Please fix the following errors:
          
          ${JSON.stringify(result.errors, null, 2)}
          
          You can use the "search_docs" tool to search the documentation for more information about the router config.
          Ask specific questions mentioning the "router config" or "cosmo router config" keywords alongside your query.`;

          return {
            content: [{ type: 'text', text: resultText }],
          };
        }

        return {
          content: [{ type: 'text', text: 'The router config is valid.' }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error}` }],
        };
      }
    },
  );
};
