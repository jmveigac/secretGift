import * as dotenv from 'dotenv';
import { sendMail } from './sendMail.js';
import { Participant } from './participant.js';

import { createTest } from './google-steps/participantsTest.js';//TODO: delete this

dotenv.config();

const participants = createTest();//TODO: allow user to input

draw(participants);

async function draw(participants) {
    let listaux = arrayCopy(participants);
    let listSelected = [];

    participants.forEach(element => {
        const result = selectGift(element, listaux, listSelected);

        listSelected.push(result);
        console.log(`${element.name} regala a ${result.name}`);
        //TODO: modify testmail to element.email
        sendMail(process.env.TESTMAIL, `${process.env.SUBJECT} 2023`, `Este año tu amigo invisible es: ${result.name} No olvides los regalos :D`, `<p>Este año tu amigo invisible es:</p><h1>${result.name}</h1><br /><br /><p>No olvides los regalos :D<p>`);
    });
}

function selectGift(selector, listToSelect, listExclude) {
    const num = Math.floor(Math.random() * listToSelect.length);
    let selected = listToSelect[num];

    if (selector.name == selected.name) return selectGift(selector, listToSelect, listExclude);
    if (selector.lastGift == selected.name) return selectGift(selector, listToSelect, listExclude);
    if (listExclude.length > 0 && listExclude.includes(selected)) return selectGift(selector, listToSelect, listExclude);

    return selected;
}

function arrayCopy(arr) {
    let aux = [];
    arr.forEach(element => {
        aux.push(element);
    });
    return aux;
}
