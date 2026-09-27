// Screenshot-like canvases: text rows, UI gradients, optional photo-like noise band and
// optional transparent region. Deterministic noise so sizes are stable between runs.
export function makeCanvas({ width = 800, height = 1200, noise = false, transparent = false } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff';
  x.fillRect(0, 0, width, height);
  x.font = '15px Segoe UI, sans-serif';
  for (let y = 0; y < height; y += 24) {
    x.fillStyle = '#222';
    x.fillText(`Lorem ipsum dolor sit amet, consectetur adipiscing elit ${y}`, 20 + (y % 120), y + 18);
  }
  for (let i = 0; i * 100 < height; i++) {
    const g = x.createLinearGradient(0, i * 100, width, i * 100 + 80);
    g.addColorStop(0, `hsl(${i * 6},70%,50%)`);
    g.addColorStop(1, `hsl(${i * 6 + 90},60%,70%)`);
    x.fillStyle = g;
    x.fillRect(width * 0.55, i * 100, width * 0.35, 70);
  }
  if (noise) {
    const bandH = Math.floor(height / 4);
    const p = x.getImageData(0, bandH, width, bandH);
    let seed = 12345;
    for (let i = 0; i < p.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = (Math.sin(i / 997) * 60 + 128 + (seed % 40)) | 0;
      p.data[i] = v;
      p.data[i + 1] = (v * 0.8) | 0;
      p.data[i + 2] = 255 - v;
      p.data[i + 3] = 255;
    }
    x.putImageData(p, 0, bandH);
  }
  if (transparent) {
    x.clearRect(0, 0, width / 3, height / 3);
    x.fillStyle = 'rgba(255, 122, 69, 0.4)';
    x.fillRect(10, 10, width / 4, height / 4);
  }
  return c;
}

export async function decodePixels(blob, width, height) {
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bitmap, 0, 0);
  bitmap.close();
  return x.getImageData(0, 0, width, height).data;
}

export const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function headText(blob, n) {
  const buf = new Uint8Array(await blob.slice(0, n).arrayBuffer());
  return String.fromCharCode(...buf);
}
