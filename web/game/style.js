// The moments of the daily life, with some ceremony: a rank earned, a skill's new level, a job done.
// A band sweeps across the picture on the sun's slant, the title lands letter-spaced in the display
// face, and it leaves the way it came. One at a time: a second waits for the first. Never in the way
// of play (no pointer events), and a plain fade for a visitor who asks for less motion.
'use strict';
window.OEStyle = (function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function create(L) {
    const stage = L.ctx.stage, queue = [];
    let cur = null, shown = [];
    function next() {
      if (cur || !queue.length) return;
      const o = queue.shift(), el = cur = document.createElement('div');
      el.className = 'lf-banner'; el.dataset.kind = o.kind || '';
      el.setAttribute('role', 'status');
      if (o.color) el.style.setProperty('--npc', o.color);
      el.innerHTML = `<div class="lf-banner-in"><span class="eyebrow">${esc(o.eyebrow || '')}</span><b>${esc(o.title)}</b>`
        + (o.pips ? `<span class="pips">${Array.from({ length: o.pips[1] }, (_, i) => `<i class="${i < o.pips[0] ? 'on' : ''}${i === o.pips[0] - 1 ? ' new' : ''}"></i>`).join('')}</span>` : '')
        + (o.sub ? `<span class="sub">${esc(o.sub)}</span>` : '') + '</div>';
      stage.appendChild(el);
      shown.push(o); if (shown.length > 8) shown.shift();
      setTimeout(() => el.classList.add('out'), o.hold || 3400);
      setTimeout(() => { el.remove(); cur = null; next(); }, (o.hold || 3400) + 650);
    }
    L.ui = { banner(o) { queue.push(o); next(); }, shown: () => shown, esc };
    return L.ui;
  }
  return { create };
})();
