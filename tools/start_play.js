// Presses Play on a game page's title card, once the card is up, and makes sure the game started (#423).
// The card is held back until the loader has faded onto the title orbit (game.js), and its parts slide
// in for a second. A Playwright click waits for the button to be visible and to stand still in two
// frames running; on a software renderer under load a frame can take seconds, so the click could time
// out after 30 s, and the old `click().catch(() => {})` then went on with the game never started: the
// arrival "over" at once and no HUD tour, the steps after on a title screen. Here the wait is for the
// card itself (as long as the load takes), the press is the button's own click (what a tap does), and a
// game that did not start throws.
//   const { startPlay } = require('./start_play'); await startPlay(page);
async function startPlay(p, { timeout = 600000, button = '#gt-play' } = {}) {
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout, polling: 250 });
  const started = await p.evaluate(sel => {
    const b = document.querySelector(sel);
    if (!b) return 'no button';
    b.click();
    return document.getElementById('g-title').hidden ? 'ok' : 'the title card is still up';
  }, button);
  if (started !== 'ok') throw new Error(`Play: ${started}`);
}
module.exports = { startPlay };
