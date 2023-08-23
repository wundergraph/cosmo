import { Configuration, OpenAIApi } from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class OpenAIGraphql {
  private readonly client: OpenAIApi;

  constructor(config: { openAiApiKey: string | undefined }) {
    const configuration = new Configuration({
      apiKey: config.openAiApiKey,
    });
    this.client = new OpenAIApi(configuration);
  }

  public async fixSDL(input: { sdl: string; checkResult: string }): Promise<{ sdl: string }> {
    const out = z.object({
      sdl: z.string().describe('The fixed GraphQL Schema'),
    });
    const res = await this.client.createChatCompletion({
      model: 'gpt-3.5-turbo',
      temperature: 0,
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
      return out.parse(JSON.parse(res.data.choices[0].message!.function_call!.arguments!));
    } catch (e: any) {
      const errorText = e.toString();
      if (errorText.includes('Unexpected token')) {
        return this.fixSDL(input);
      }
      console.log(`OpenAI fixSDL failed: ${errorText}\n\nresponse:\n\n${JSON.stringify(res.data)}`);
      throw new Error('OpenAI fixSDL failed');
    }
  }
}
