// Presses Play on a game page's title card, once the card is up, and makes sure the game started (#423).
// The card is held back until the loader has faded onto the title orbit (game.js), and its parts slide
// in for a second. A Playwright click waits for the button to be visible and to stand still in two
// frames running; on a software renderer under load a frame can take seconds, so the click could time
// out after 30 s, and the old `click().catch(() => {})` then went on with the game never started: the
// arrival "over" at once and no HUD tour, the steps after on a title screen. Here the wait is for the
// card itself (as long as the load takes), the press is the button's own click (what a tap does), and a
// game that did not start throws.
//   const { startPlay } = require('./start_play'); await startPlay(page);
// A player starts at the place's own time, in real time (game.js clock). The harnesses were written for a day
// that runs: unless `asIs`, the game's day runs 30 times faster here, and after dark the morning is picked on
// the card, so a run does not depend on the hour it is started at.
async function startPlay(p, { timeout = 600000, button = '#gt-play', asIs = false } = {}) {
  await p.waitForFunction(() => { const t = document.getElementById('g-title'); return t && !t.hidden; }, null, { timeout, polling: 250 });
  const started = await p.evaluate(([sel, asIs]) => {
    const b = document.querySelector(sel), g = window.__game;
    if (!b) return 'no button';
    if (!asIs && g && g.clock && g.dayLimits) {
      const d = g.dayLimits(), morning = document.querySelector('#gt-timechoice [data-t="morning"]');
      if (morning && (g.clock.min < d.sunrise + 10 || g.clock.min > d.sunset - 10)) morning.click();
    }
    b.click();
    if (!asIs && g && g.clock) g.clock.scale = 30;
    return document.getElementById('g-title').hidden ? 'ok' : 'the title card is still up';
  }, [button, asIs]);
  if (started !== 'ok') throw new Error(`Play: ${started}`);
}
module.exports = { startPlay };
