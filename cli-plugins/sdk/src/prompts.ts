import { createInterface } from 'node:readline/promises';

export interface Prompts {
  /** False when the caller cannot be asked; callers then take the default or require a flag. */
  readonly canPrompt: boolean;
  confirm(question: string, defaultAnswer: boolean): Promise<boolean>;
  text(question: string, defaultAnswer?: string): Promise<string>;
}

export const createPrompts = ({
  canPrompt,
  input = process.stdin,
  output = process.stderr,
}: {
  canPrompt: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Prompts => {
  const ask = async (question: string): Promise<string> => {
    const readline = createInterface({ input, output });
    try {
      return (await readline.question(question)).trim();
    } finally {
      readline.close();
    }
  };

  return {
    canPrompt,
    async confirm(question, defaultAnswer) {
      if (!canPrompt) {
        return defaultAnswer;
      }
      const answer = (await ask(`${question} ${defaultAnswer ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
      if (answer === '') {
        return defaultAnswer;
      }
      return answer === 'y' || answer === 'yes';
    },
    async text(question, defaultAnswer = '') {
      if (!canPrompt) {
        return defaultAnswer;
      }
      const answer = await ask(defaultAnswer ? `${question} (${defaultAnswer}) ` : `${question} `);
      return answer === '' ? defaultAnswer : answer;
    },
  };
};
