import { OpenAI, ClientOptions } from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class OpenAIGraphql {
  private readonly client: OpenAI;

  constructor(config: { openAiApiKey: string | undefined }) {
    const configuration: ClientOptions = {
      apiKey: config.openAiApiKey,
    };
    this.client = new OpenAI(configuration);
  }

  public async createREADME(input: { graphName: string; sdl: string }): Promise<{ readme: string }> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a friendly assistant that helps to create documentation for users based on GraphQL schema. The output must be markdown. Concentrate what data can be retrieved from it and what use cases it enables from a consumer perspective. The name of the project is "${input.graphName}". Start with a short but easy to understand summary, conclude with key features and use cases. Add exactly one example for a valid graphql query according to the provided graph schema.
`,
        },
        {
          role: 'user',
          content: `Use the following graphql schema to generate the readme: ${input.sdl}`,
        },
      ],
      temperature: 0,
      max_tokens: 1000,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false,
    });

    return { readme: response.choices[0].message.content ?? '' };
  }

  public async fixSDL(input: { sdl: string; checkResult: string }): Promise<{ sdl: string }> {
    const out = z.object({
      sdl: z.string().describe('The fixed GraphQL Schema'),
    });

    const res = await this.client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0,
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
    });

    try {
      return out.parse(JSON.parse(res.choices[0].message!.function_call!.arguments!));
    } catch (e: any) {
      const errorText = e.toString();
      if (errorText.includes('Unexpected token')) {
        return this.fixSDL(input);
      }
      throw new Error('OpenAI fixSDL failed');
    }
  }
}
