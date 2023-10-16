import Participants from '../models/participants';

export const createHtmlMessage = (participant: Participants, selected: string) => {
    return `<div style="position: relative;">
        <img style="max-width: 400px;"
            src="https://th.bing.com/th/id/R.b474e1cdc0c26f71e9e284b6211eb2e5?rik=ed3A7CVCIDjICw&riu=http%3a%2f%2fwallpapercave.com%2fwp%2fx3hB5L1.jpg&ehk=1HShmtIwqESGz4lDhB%2b1ZTNvEKldnYQ%2b9KcQkLzkQU8%3d&risl=&pid=ImgRaw&r=0" />

        <div style="position: absolute;top: 0;left: 0;right: 0;margin: 0 auto;">
            <h2 style="color: white;">Hola ${participant.name}</h2>
            <h3 style="color: white;">Este año tu amigo invisible es:</h3>
            <br />
            <br />
            <h1 style="color: white;">${selected}</h1>
            <br />
            <br />
            <h3 style="color: white;">No olvides los regalos :D</h3>
        </div>
    </div>`;
};