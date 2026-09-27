import { isPublicUploadUrl } from '../lib/upload-client.js';
import { FORMAT_INFO } from '../lib/encode.js';
import { formatMB } from '../lib/compress.js';

const params = new URLSearchParams(location.search);
const url = params.get('url');
const format = FORMAT_INFO[params.get('fmt')] ? params.get('fmt') : null;
const size = Number(params.get('size'));

const $ = (id) => document.getElementById(id);

if (!isPublicUploadUrl(url)) {
  $('shareError').hidden = false;
} else {
  const isPdf = format === 'pdf' || url.endsWith('.pdf');
  $('shareCard').hidden = false;
  $('previewLink').href = url;
  $('openLink').href = url;
  $('openLink').textContent = isPdf ? 'Open PDF' : 'Open image';
  if (isPdf) {
    $('previewPdf').hidden = false;
  } else {
    $('previewImg').src = url;
    $('previewImg').hidden = false;
  }
  $('fileInfo').textContent = [format && FORMAT_INFO[format].label, size > 0 && formatMB(size)].filter(Boolean).join(' · ');

  const field = $('urlField');
  field.value = url;
  field.addEventListener('focus', () => field.select());
  field.focus();
  field.select();

  const copyBtn = $('copyLinkBtn');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = 'Copied ✓';
    } catch (err) {
      console.error('[PagePixel]', err);
      field.select();
      copyBtn.textContent = 'Press Ctrl+C to copy';
    }
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 2000);
  });
}
