// Source: installed Counter-Strike 2 build 25815307, exported with Source 2 Viewer 20.0.
// Exact vanilla names only. Painted skins and StatTrak keep their catalog images.
window.CS2_EXACT_MODELS = Object.freeze({
  '★ Bayonet': 'models/refined/bayonet.glb',
  '★ Bowie Knife': 'models/refined/bowie.glb',
  '★ Butterfly Knife': 'models/refined/butterfly.glb',
  '★ Survival Knife': 'models/refined/canis.glb',
  '★ Paracord Knife': 'models/refined/cord.glb',
  '★ Classic Knife': 'models/refined/css.glb',
  '★ Falchion Knife': 'models/refined/falchion.glb',
  '★ Flip Knife': 'models/refined/flip.glb',
  '★ Gut Knife': 'models/refined/gut.glb',
  '★ Karambit': 'models/refined/karambit.glb',
  '★ Kukri Knife': 'models/refined/kukri.glb',
  '★ M9 Bayonet': 'models/refined/m9.glb',
  '★ Navaja Knife': 'models/refined/navaja.glb',
  '★ Nomad Knife': 'models/refined/outdoor.glb',
  '★ Shadow Daggers': 'models/refined/push.glb',
  '★ Skeleton Knife': 'models/refined/skeleton.glb',
  '★ Stiletto Knife': 'models/refined/stiletto.glb',
  '★ Huntsman Knife': 'models/refined/tactical.glb',
  '★ Talon Knife': 'models/refined/talon.glb',
  '★ Ursus Knife': 'models/refined/ursus.glb'
});

window.CS2_HELD_MODELS = Object.freeze(Object.fromEntries(
  Object.entries(window.CS2_EXACT_MODELS).map(([name, path]) => [name, path.replace('models/refined/', 'models/held-')])
));

// Vanilla assets have no paint-wear compositor. Keep the numeric simulation
// setting separate from the original texture's authored surface details.
window.CS2_PREVIEW_WEAR = 0;

function fitHeldCamera(viewer) {
  const portrait = viewer.clientWidth / Math.max(viewer.clientHeight, 1) < 0.85;
  viewer.setAttribute('camera-target', portrait ? '-0.14m 0.02m 0.45m' : '0m 0.02m 0.45m');
  viewer.setAttribute('camera-orbit', portrait ? '180deg 85deg 1.5m' : '180deg 85deg 1m');
  viewer.jumpCameraToGoal?.();
}
window.CS2_PREVIEW_RESIZE?.disconnect();
window.CS2_PREVIEW_RESIZE = new ResizeObserver(() => {
  const viewer = document.getElementById('winner-model');
  if (viewer && window.CS2_HELD_MODE) fitHeldCamera(viewer);
});

window.playCaseInspection = async function() {
  const viewer = document.getElementById('winner-model');
  const button = document.getElementById('winner-inspect-action');
  if (!viewer?.loaded || !window.CS2_HELD_MODE || !viewer.paused) return;
  const animationName = viewer.availableAnimations[0];
  if (!animationName) {
    if (button) {
      button.disabled = true;
      button.textContent = 'KHÔNG CÓ THAO TÁC';
    }
    return;
  }
  viewer.animationName = animationName;
  if (button) {
    button.disabled = true;
    button.textContent = 'ĐANG XEM…';
    button.setAttribute('aria-pressed', 'true');
  }
  await viewer.updateComplete;
  if (viewer !== document.getElementById('winner-model') || !window.CS2_HELD_MODE) return;
  viewer.currentTime = 0;
  viewer.play({ repetitions: 1 });
};

window.showCaseModel = function(item, held = true) {
  if (window.CS2_EXACT_MODELS[item.name]) {
    item = { ...item, wearFloat: window.CS2_PREVIEW_WEAR, wear: `Độ mòn mô phỏng: ${window.CS2_PREVIEW_WEAR.toFixed(9)}` };
    const wear = document.getElementById('winner-wear');
    if (wear) wear.textContent = `${item.type || 'Dao nguyên bản'} · ${item.wear}`;
  }
  let viewer = document.getElementById('winner-model');
  const image = document.getElementById('winner-img');
  const hint = document.getElementById('winner-model-hint');
  if (!viewer || !image) return;
  const cleanViewer = viewer.cloneNode(false);
  cleanViewer.removeAttribute('src');
  viewer.replaceWith(cleanViewer);
  viewer = cleanViewer;
  window.CS2_PREVIEW_RESIZE.disconnect();
  window.CS2_PREVIEW_RESIZE.observe(viewer);
  window.CS2_PREVIEW_ITEM = item;
  window.CS2_HELD_MODE = held && Boolean(window.CS2_HELD_MODELS[item.name]);
  const toggle = document.getElementById('winner-held-toggle');
  const inspectAction = document.getElementById('winner-inspect-action');
  if (inspectAction) {
    inspectAction.hidden = !window.CS2_HELD_MODE;
    inspectAction.disabled = true;
    inspectAction.textContent = 'ĐANG TẢI THAO TÁC…';
    inspectAction.setAttribute('aria-pressed', 'false');
  }
  toggle.hidden = !window.CS2_HELD_MODELS[item.name];
  toggle.textContent = window.CS2_HELD_MODE ? 'XEM DAO RỜI' : 'XEM TAY CẦM DAO';
  const knifeSelect = document.getElementById('winner-knife-select');
  knifeSelect.hidden = !window.CS2_HELD_MODELS[item.name];
  if (!knifeSelect.options.length) {
    Object.keys(window.CS2_HELD_MODELS).forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      knifeSelect.appendChild(option);
    });
  }
  knifeSelect.value = item.name;
  const model = window.CS2_HELD_MODE ? window.CS2_HELD_MODELS[item.name] : window.CS2_EXACT_MODELS[item.name];
  if (window.CS2_HELD_MODE) {
    viewer.setAttribute('shadow-intensity', '0');
    viewer.removeAttribute('camera-controls');
    viewer.setAttribute('camera-target', '0m 0.02m 0.45m');
    viewer.setAttribute('camera-orbit', '180deg 85deg 1m');
    viewer.setAttribute('min-camera-orbit', '-Infinity 0deg 0.15m');
    viewer.setAttribute('max-camera-orbit', 'Infinity 180deg 3m');
    hint.textContent = 'Dao tự chạy thao tác một lần khi tải xong; có thể bấm nút để xem lại';
  } else {
    viewer.setAttribute('shadow-intensity', '0.6');
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('camera-target', 'auto auto auto');
    viewer.setAttribute('camera-orbit', '0deg 75deg auto');
    viewer.setAttribute('min-camera-orbit', '-Infinity 0deg auto');
    viewer.setAttribute('max-camera-orbit', 'Infinity 180deg auto');
    hint.textContent = 'Kéo ngang: xoay 360° · Kéo dọc: lật trên/dưới · Cuộn: phóng to';
  }
  viewer.hidden = true;
  image.hidden = false;
  hint.hidden = true;
  viewer.removeAttribute('src');
  if (!model) return;
  viewer.alt = item.name;
  // A display:none model-viewer defers loading until it becomes visible.
  // Show its catalog poster immediately so the model can actually load.
  viewer.setAttribute('poster', item.image);
  viewer.setAttribute('loading', 'eager');
  viewer.hidden = false;
  image.hidden = true;
  viewer.addEventListener('load', () => {
    if (viewer.getAttribute('src') !== model) return;
    // Corrected maps already preserve the original roughness/metalness values.
    for (const material of viewer.model?.materials || []) {
      material.pbrMetallicRoughness.setRoughnessFactor(1);
    }
    viewer.hidden = false;
    image.hidden = true;
    hint.hidden = false;
    if (window.CS2_HELD_MODE) {
      fitHeldCamera(viewer);
      if (inspectAction) {
        inspectAction.disabled = !viewer.availableAnimations.length;
        inspectAction.textContent = viewer.availableAnimations.length ? 'XEM THAO TÁC' : 'KHÔNG CÓ THAO TÁC';
      }
      if (viewer.availableAnimations.length) window.playCaseInspection();
    }
  }, { once: true });
  viewer.addEventListener('error', () => {
    viewer.hidden = true;
    image.hidden = false;
    hint.hidden = true;
    if (inspectAction) {
      inspectAction.disabled = true;
      inspectAction.textContent = 'KHÔNG TẢI ĐƯỢC THAO TÁC';
    }
  }, { once: true });
  viewer.addEventListener('finished', () => {
    viewer.pause();
    if (inspectAction && viewer === document.getElementById('winner-model')) {
      inspectAction.disabled = false;
      inspectAction.textContent = 'XEM THAO TÁC';
      inspectAction.setAttribute('aria-pressed', 'false');
    }
  });
  viewer.setAttribute('src', model);
};
