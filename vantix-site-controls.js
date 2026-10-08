(() => {
  const downloadName = 'VN-KEEN.SKIN.V2.1.3.zip';

  // Keep old homepage links working while the site moves to the VANTIX file name.
  document.querySelectorAll('a[download]').forEach((link) => {
    if (link.getAttribute('href') === 'VN-KEEN-SKIN.zip' || link.getAttribute('href') === 'VN-KEEN-SKIN.rar') {
      link.setAttribute('href', downloadName);
    }
  });

  // Essentials/AIM is no longer offered for new rentals. Keep the backend
  // routes available so keys already issued to customers are unaffected.
  const product = document.querySelector('#product');
  if (product) {
    product.querySelectorAll('option[value="aim"]').forEach((option) => option.remove());
  }
  document.querySelectorAll('p').forEach((paragraph) => {
    if (/Giá AIM|AIM chỉ hiển thị/i.test(paragraph.textContent || '')) paragraph.remove();
  });
})();
