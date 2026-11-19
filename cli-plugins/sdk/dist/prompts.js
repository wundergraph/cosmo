import { createInterface } from 'node:readline/promises';
export const createPrompts = ({ canPrompt, input = process.stdin, output = process.stderr, }) => {
    const ask = async (question) => {
        const readline = createInterface({ input, output });
        try {
            return (await readline.question(question)).trim();
        }
        finally {
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
//# sourceMappingURL=prompts.js.map