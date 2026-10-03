export const ESSENTIALS_RELEASE = 'VN-KEEN-ESSENTIALS-20261003-LicenseGate-14188.zip';
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export function validateRelease(manifest) {
  const release = manifest?.products?.aim;
  if (manifest?.schemaVersion !== 1 || release?.file !== ESSENTIALS_RELEASE ||
      release?.scope !== 'VN-KEEN-AIM' || !Number.isSafeInteger(release?.sizeBytes) ||
      release.sizeBytes <= 0 || release.sizeBytes > MAX_DOWNLOAD_BYTES ||
      !/^[a-f0-9]{64}$/i.test(release?.sha256 || '')) {
    throw new Error('Thông tin bản tải chưa hợp lệ. Vui lòng liên hệ hỗ trợ.');
  }
  return release;
}

export async function readReleaseBytes(response, expectedSize) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_DOWNLOAD_BYTES) {
    throw new Error('Kích thước bản tải không hợp lệ. Đã dừng tải để kiểm tra.');
  }
  if (!response.ok) throw new Error('Không tải được gói Essentials. Vui lòng thử lại sau.');
  const contentLength = response.headers.get('Content-Length');
  if (contentLength !== null && Number(contentLength) !== expectedSize) {
    throw new Error('Kích thước bản tải không khớp. Đã dừng tải để kiểm tra.');
  }
  if (!response.body?.getReader) throw new Error('Trình duyệt chưa hỗ trợ kiểm tra bản tải này.');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedSize);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedSize || offset + value.byteLength > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error('Kích thước bản tải vượt giới hạn. Đã dừng tải để kiểm tra.');
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedSize) throw new Error('Bản tải chưa đầy đủ. Vui lòng thử lại sau.');
  return bytes;
}

export async function verifyReleaseBytes(bytes, release, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Trình duyệt chưa hỗ trợ xác minh SHA-256. Hãy dùng trình duyệt mới qua HTTPS.');
  if (bytes.byteLength !== release.sizeBytes || bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Kích thước bản tải không khớp. Đã dừng tải để kiểm tra.');
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== release.sha256.toLowerCase()) {
    throw new Error('SHA-256 không khớp: tệp tải về khác bản phát hành. Đã chặn lưu tệp; vui lòng liên hệ hỗ trợ.');
  }
  return actual;
}

export async function verifiedEssentialsDownload({ fetcher = globalThis.fetch, cryptoApi = globalThis.crypto, baseUrl = globalThis.location?.href } = {}) {
  if (!cryptoApi?.subtle) throw new Error('Trình duyệt chưa hỗ trợ xác minh SHA-256. Hãy dùng trình duyệt mới qua HTTPS.');
  const manifestResponse = await fetcher(new URL('downloads.json', baseUrl), { cache: 'no-store', credentials: 'same-origin' });
  if (!manifestResponse.ok) throw new Error('Chưa lấy được thông tin xác minh bản tải. Vui lòng thử lại sau.');
  const release = validateRelease(await manifestResponse.json());
  const response = await fetcher(new URL(release.file, baseUrl), { cache: 'no-store', credentials: 'same-origin' });
  const bytes = await readReleaseBytes(response, release.sizeBytes);
  await verifyReleaseBytes(bytes, release, cryptoApi);
  return { bytes, release };
}

function showStatus(message, error = false) {
  let status = document.getElementById('download-integrity-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'download-integrity-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.style.cssText = 'position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);width:calc(100% - 32px);max-width:560px;padding:14px 18px;border:1px solid #22d3ee;border-radius:12px;background:#0e1628;color:#e2e8f0;box-shadow:0 12px 38px #0007;font:13px/1.6 sans-serif;';
    document.body.appendChild(status);
  }
  status.style.borderColor = error ? '#fb7185' : '#22d3ee';
  status.textContent = message;
}

if (typeof document !== 'undefined') {
  let inProgress = false;
  document.addEventListener('click', async event => {
    const anchor = event.target?.closest?.('a[download]');
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname !== `/${ESSENTIALS_RELEASE}`) return;
    event.preventDefault();
    if (inProgress) return;
    inProgress = true;
    showStatus('Đang tải Essentials và đối chiếu SHA-256 trước khi lưu…');
    try {
      const { bytes, release } = await verifiedEssentialsDownload();
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const save = document.createElement('a');
      save.href = blobUrl;
      save.download = release.file;
      document.body.appendChild(save);
      save.click();
      save.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      showStatus('SHA-256 khớp bản phát hành. Đã gửi tệp cho trình duyệt lưu. Xác minh toàn vẹn không phải chứng nhận không có mã độc.');
    } catch (error) {
      showStatus(error?.message || 'Không xác minh được bản tải. Đã dừng; vui lòng liên hệ hỗ trợ.', true);
    } finally {
      inProgress = false;
    }
  }, true);
}
