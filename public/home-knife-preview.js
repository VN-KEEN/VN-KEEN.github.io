(() => {
  const fullscreenButton = () => document.getElementById('hero-knife-fullscreen');
  const previewCard = () => document.querySelector('.hero-knife-preview');
  const syncFullscreenButton = () => {
    const card = previewCard();
    const button = fullscreenButton();
    if (!card || !button) return;
    const expanded = document.fullscreenElement === card || card.classList.contains('is-fullscreen');
    button.textContent = expanded ? 'THOÁT TOÀN MÀN HÌNH' : 'PHÓNG TO TOÀN MÀN HÌNH';
    button.setAttribute('aria-pressed', String(expanded));
  };

  window.toggleHomepageKnifeFullscreen = async () => {
    const card = previewCard();
    if (!card) return;
    try {
      if (document.fullscreenElement === card) {
        await document.exitFullscreen();
      } else if (card.requestFullscreen) {
        await card.requestFullscreen();
      } else {
        card.classList.toggle('is-fullscreen');
        syncFullscreenButton();
      }
    } catch (error) {
      console.error('Could not toggle homepage knife fullscreen.', error);
      const status = document.getElementById('hero-knife-loading');
      status.hidden = false;
      status.textContent = 'Không thể phóng to toàn màn hình trong trình duyệt này.';
    }
  };

  document.addEventListener('fullscreenchange', syncFullscreenButton);
  document.addEventListener('keydown', async (event) => {
    if (event.key !== 'Escape') return;
    const card = previewCard();
    if (card?.classList.contains('is-fullscreen')) {
      card.classList.remove('is-fullscreen');
      syncFullscreenButton();
    } else if (document.fullscreenElement === card) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.error('Could not exit homepage knife fullscreen.', error);
      }
    }
  });

  window.previewHomepageKnife = (name) => {
    const item = window.CS2_KNIFE_PREVIEW_ITEMS.find((entry) => entry.name === name);
    if (!item) return;
    document.getElementById('hero-knife-name').textContent = item.name;
    const image = document.getElementById('winner-img');
    image.src = item.image;
    image.alt = item.name;
    const status = document.getElementById('hero-knife-loading');
    status.hidden = false;
    status.textContent = 'Đang tải mô hình dao…';
    showCaseModel(item, true);
    const viewer = document.getElementById('winner-model');
    viewer.addEventListener('load', () => {
      if (viewer === document.getElementById('winner-model')) status.hidden = true;
    }, { once: true });
    viewer.addEventListener('error', () => {
      if (viewer === document.getElementById('winner-model')) status.textContent = 'Tải lại để xem dao 3D';
    }, { once: true });
  };
  customElements.whenDefined('model-viewer').then(() => previewHomepageKnife('★ Karambit'));
})();
