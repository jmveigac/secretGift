require('dotenv').config();

export interface EnvVariables {
    FROM: string;
    HOST: string;
    PORT: string;
    MAILUSER: string;
    MAILPWD: string;
    SUBJECT: string;
    TESTMAIL: string;
}

const envVariables: EnvVariables = {
    FROM: process.env.FROM!,
    HOST: process.env.HOST!,
    PORT: process.env.PORT!,
    MAILUSER: process.env.MAILUSER!,
    MAILPWD: process.env.MAILPWD!,
    SUBJECT: process.env.SUBJECT!,
    TESTMAIL: process.env.TESTMAIL!
};

export default { ...envVariables };