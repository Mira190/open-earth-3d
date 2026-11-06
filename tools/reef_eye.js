// An expression for tools/reef_shot.js (PROBE=tools/reef_eye.js): stands the free camera EYE metres (env, default 1.6)
// above the drawn ground where it is, so an eye-level still needs no ground height in its address.
(async () => {
  const r = window.__reef, c = r.camera, eye = Number(window.__eye || 1.6);
  for (let i = 0; i < 3; i++) {
    const h = r.ctx.terrain.heightAt(c.position.x, -c.position.z);
    c.position.y = h + eye;
    await new Promise(res => setTimeout(res, 1500));
  }
  return c.position.y;
})()
