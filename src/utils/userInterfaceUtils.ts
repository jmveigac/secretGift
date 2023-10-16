import * as readline from 'readline/promises';

export const readUserData = async (askUser: string) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await rl.question(`${askUser}: `, {
            signal: AbortSignal.timeout(10_000)
        });

        return answer;
    } finally {
        rl.close();
    }
};

export const confirmUser = async (askConfirmUser: string) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await rl.question(`${askConfirmUser}[Y/N] `, {
            signal: AbortSignal.timeout(10_000)
        });

        return answer.toLowerCase();
    } finally {
        rl.close();
    }
};