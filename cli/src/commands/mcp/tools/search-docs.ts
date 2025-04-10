import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { z } from 'zod';
import axios from 'axios';
import { TrieveSDK } from 'trieve-ts-sdk';
import { ToolContext } from './types.js';

export const registerSearchDocsTool = ({ server, opts }: ToolContext) => {
  let trieve: TrieveSDK;

  server.tool(
    'search_docs',
    'Search the Cosmo docs for a given query, e.g. to understand the Router Configuration or how Cosmo works in detail.',
    { query: z.string() },
    async ({ query }) => {
      try {
        if (!trieve) {
          const config = await axios.get(`https://leaves.mintlify.com/api/mcp/config/wundergraphinc`);

          trieve = new TrieveSDK({
            apiKey: config.data.trieveApiKey,
            datasetId: config.data.trieveDatasetId,
            baseUrl: 'https://api.mintlifytrieve.com',
          });
        }
      } catch (error) {
        throw new Error(`Error initializing Docs Search: ${error}`);
      }

      try {
        const data = await trieve.autocomplete({
          page_size: 10,
          query,
          search_type: 'fulltext',
          extend_results: true,
          score_threshold: 1,
        });

        const searchResultsJSON = JSON.stringify(data, null, 2);
        const resultText = `${searchResultsJSON}
        
        If you're making suggestions for Cosmo Router Configurations,
        please always suggest to use the "verify_router_config" tool to validate your configuration before applying changes.`;

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        console.error(error);
        return {
          content: [{ type: 'text', text: 'Error searching docs, please try with a different query.' }],
        };
      }
    },
  );
};
