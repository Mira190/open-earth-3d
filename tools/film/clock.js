// A virtual clock for filming a page frame by frame (added before the page's own scripts).
// While it is off the page runs in real time, so the city loads as usual. Once __vt.start()
// is called, performance.now() stands still and requestAnimationFrame callbacks wait until
// __vt.step(ms) moves the clock on and runs them, however long the frame takes to draw.
(() => {
  let virt = false, vt = 0, q = [], id = 1;
  const rNow = performance.now.bind(performance), rRAF = window.requestAnimationFrame.bind(window);
  performance.now = () => (virt ? vt : rNow());
  window.requestAnimationFrame = cb => { if (!virt) return rRAF(cb); q.push(cb); return id++; };
  window.__vt = {
    start() { vt = rNow(); virt = true; },
    step(ms) { vt += ms; const run = q; q = []; for (const cb of run) cb(vt); return run.length; },
    get on() { return virt; },
    get pending() { return q.length; },
  };
})();
