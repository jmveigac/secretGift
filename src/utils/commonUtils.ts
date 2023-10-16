import * as fs from 'fs';
import Participants from '../models/participants';

export const arrayCopy = (arr: any[]) => {
    let aux: any[] = [];
    arr.forEach(element => {
        aux.push(element);
    });
    return aux;
};

export const readJson = (pathJson: string): Participants[] => {
    try {
        const jsonString = fs.readFileSync(pathJson).toString();
        return JSON.parse(decodeBase(jsonString)) as Participants[];
    } catch (err) {
        throw err;
    }
};

export const writeJson = (participants: Participants[]) => {
    try {
        const jsonString = JSON.stringify(participants);
        fs.writeFileSync('./newParticipants.json', encodeBase(jsonString));
    } catch (error) {
        throw error;
    }
};

const decodeBase = (baseString: string) => {
    const buffer = Buffer.from(baseString, 'base64');
    const decodedString = buffer.toString('utf8');
    return decodedString;
};

const encodeBase = (decodedString: string) => {
    const buffer = Buffer.from(decodedString, 'utf8');
    const encodedString = buffer.toString('base64');
    return encodedString;
};