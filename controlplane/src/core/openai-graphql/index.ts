import { OpenAI, ClientOptions } from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import pRetry, { AbortError } from 'p-retry';

export class OpenAIGraphql {
  private readonly client: OpenAI;

  constructor(config: { openAiApiKey: string | undefined }) {
    const configuration: ClientOptions = {
      apiKey: config.openAiApiKey,
    };
    this.client = new OpenAI(configuration);
  }

  public async generateReadme(input: { graphName: string; sdl: string }): Promise<{ readme: string }> {
    const response = await this.client.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a friendly assistant that helps to create documentation for users based on GraphQL schema. The output must be markdown. Concentrate what data can be retrieved from it and what use cases it enables from a consumer perspective. The name of the graph is "${input.graphName}". Start with a short but easy to understand summary, conclude with key features and use cases. Add exactly one example for a valid graphql query according to the provided graph schema.
`,
          },
          {
            role: 'user',
            content: `Use the following graphql schema to generate the readme:
          \`\`\`graphql
          ${input.sdl}
          \`\`\`
          `,
          },
        ],
        temperature: 0,
        max_tokens: 1000,
        n: 1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: false,
      },
      {
        timeout: 60_000,
      },
    );

    if (response.choices?.length === 0) {
      throw new Error('OpenAI generateReadme failed with empty choices');
    }

    return { readme: response.choices[0].message.content ?? '' };
  }

  public fixSDL(input: { sdl: string; checkResult: string }): Promise<{ sdl: string }> {
    const run = () => this._fixSDL(input);
    return pRetry(run, { retries: 3 });
  }

  private async _fixSDL(input: { sdl: string; checkResult: string }): Promise<{ sdl: string }> {
    const out = z.object({
      sdl: z.string().describe('The fixed GraphQL Schema'),
    });

    const res = await this.client.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0,
        n: 1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: false,
        messages: [
          {
            role: 'user',
            content: `Given the following SDL (Schema Definition Language) from an Apollo Federation subgraph:
                    
                    \`\`\`graphql
                    ${input.sdl}
                    \`\`\`
                    
                    I've got the following schema composition result back from rover:
                    
                    \`\`\`
                    ${input.checkResult}
                    \`\`\`
                    
                    Please take into consideration the schema check result and generate a fixed version of the SDL.
                    Once completed, store the SDL using the 'store_sdl' function.`,
          },
        ],
        functions: [
          {
            name: 'store_sdl',
            description:
              'This function allows the Agent to store the fixed SDL. The SDL must be returned in plain text as a GraphQL Schema.',
            parameters: zodToJsonSchema(out),
          },
        ],
      },
      {
        timeout: 60_000,
      },
    );

    if (res.choices?.length === 0) {
      throw new AbortError('OpenAI fixSDL failed with empty choices');
    }

    try {
      return out.parse(JSON.parse(res.choices[0].message!.function_call!.arguments!));
    } catch (e: any) {
      const errorText = e.toString();
      if (errorText.includes('Unexpected token')) {
        throw e;
      }
      throw new AbortError('OpenAI fixSDL failed');
    }
  }
}
