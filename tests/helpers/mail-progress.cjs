const { setTimeout } = require('node:timers/promises');

async function waitForMail(status) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
        const state = await status();
        if (!state.delivery.active) return state;
        await setTimeout(10);
    }
    throw new Error('Mail operation did not finish');
}

module.exports = { waitForMail };
