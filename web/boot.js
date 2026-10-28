// three.js r186 as ES modules from a CDN. The app scripts are classic scripts that read a
// global THREE, so this module builds that global (the core, plus the addons they use) and
// then loads the scripts in order.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

window.THREE = Object.assign({}, T, { OrbitControls, Sky, GLTFLoader, SkeletonUtils });

const scripts = ['sun.js', 'globe.js', 'world.js', 'city.js', 'game/nav.js', 'game/actors.js', 'game/people.js',
  'game/vehicles.js', 'game/audio.js', 'game/hud.js', 'game/game.js', 'router.js'];
for (const src of scripts) {
  await new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = res;
    el.onerror = () => rej(new Error(`failed to load ${src}`));
    document.body.append(el);
  });
}
