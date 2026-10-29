// A harbour light show for the model viewer and the game: searchlight beams from the tops of the
// city's landmarks, lasers between them and the landmarks' floodlights cycling through colours,
// for a few minutes each night from the config's start time (city.json "light_show"). Hong Kong's
// is A Symphony of Lights; the beams and colours here are illustrative, not its choreography.
'use strict';
window.OELights = (function () {
  const W = (x, y, z) => new THREE.Vector3(x, z, -y);
  const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let fadeTex = null;
  function fade() { // alpha along a beam: bright at the lamp, gone by the far end
    if (fadeTex) return fadeTex;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    return (fadeTex = new THREE.CanvasTexture(c));
  }

  function create(world, D, Wd) {
    const cfg = D.scene.city.light_show, LM = D.scene.landmarks || {};
    if (!cfg) return null;
    const start = hm(cfg.start || '20:00'), len = cfg.minutes || 10, group = new THREE.Group();
    group.visible = false;
    world.add(group);
    const top = k => { const l = LM[k]; return l ? [l.at[0], l.at[1], l.published_top_m ? l.ground_m + l.published_top_m : l.top_m] : null; };
    const colours = (cfg.colours || ['#bfe3ff', '#7ff7ff', '#ff6bd5', '#8dff7a', '#ffffff']).map(c => new THREE.Color(c));
    const beams = [];
    const L = cfg.beam_m || 1600;
    const geo = new THREE.CylinderGeometry(0.6, L * 0.035, L, 16, 1, true).translate(0, L / 2, 0);
    (cfg.beams || []).forEach((k, i) => {
      const p = top(k);
      if (!p) return;
      for (let j = 0; j < 2; j++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colours[(i * 2 + j) % colours.length], alphaMap: fade(), transparent: true,
          opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.position.copy(W(p[0], p[1], p[2] - 4));
        m.renderOrder = 30;
        group.add(m);
        beams.push({ m, phase: i * 1.7 + j * Math.PI, speed: 0.22 + 0.05 * ((i + j) % 3) });
      }
    });
    const lasers = [];
    for (const [a, b] of cfg.lasers || []) {
      const pa = top(a), pb = top(b);
      if (!pa || !pb) continue;
      const g = new THREE.BufferGeometry().setFromPoints([W(pa[0], pa[1], pa[2] - 8), W(pb[0], pb[1], pb[2] - 8)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(cfg.laser || '#3dff6a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      l.renderOrder = 31;
      group.add(l);
      lasers.push(l);
    }
    const flood = Object.values(Wd.floodMats || {});
    const own = flood.map(m => m.emissive.clone()); // each floodlight's colour, for after the show
    let minute = 0, on = false;
    const api = {
      cfg,
      active: () => on,
      // the local clock, minutes after midnight; the show runs from start for len minutes after dark
      setClock(min) {
        const was = on;
        on = Wd.U.uNight.value > 0.5 && min >= start && min < start + len;
        minute = min;
        group.visible = on;
        if (was && !on) flood.forEach((m, i) => m.emissive.copy(own[i]));
      },
      tick(t) {
        if (!on) return;
        const s = t / 1000, ramp = Math.min(1, (minute - start) * 2, (start + len - minute) * 2);
        for (const b of beams) {
          const az = b.phase + Math.sin(s * b.speed + b.phase) * 0.9, el = 1.05 + 0.32 * Math.sin(s * b.speed * 1.7 + b.phase);
          b.m.rotation.set(0, 0, 0);
          b.m.rotation.order = 'YXZ';
          b.m.rotation.y = az;
          b.m.rotation.x = Math.PI / 2 - el;
          b.m.material.opacity = 0.22 * ramp * (0.75 + 0.25 * Math.sin(s * 3 + b.phase));
        }
        lasers.forEach((l, i) => { l.material.opacity = ramp * (Math.sin(s * 2.2 + i * 1.3) > 0.2 ? 0.9 : 0.0); });
        flood.forEach((m, i) => { m.emissive.setHSL((s * 0.06 + i * 0.17) % 1, 0.85, 0.55); m.emissiveIntensity = 0.75 * ramp; });
      },
    };
    return api;
  }
  return { create };
})();
