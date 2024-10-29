import Participants from '../models/participants';

export const createHtmlMessage = (participant: Participants, selected: string) => {
    return `<div style="position: relative;">
        <div style="position: absolute;top: 0;left: 0;right: 0;margin: 0 auto;">
            <h2>Hola ${participant.name}</h2>
            <h3>Este año tu amigo invisible es:</h3>
            <br />
            <br />
            <h1>${selected}</h1>
            <br />
            <br />
            <h3>No olvides los regalos :D</h3>
        </div>
    </div>`;
};