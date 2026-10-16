// Reads a screenshot chosen by the user as a data URL, after checking it is
// an image. Big photos (phone cameras give 4–8 MB) are scaled down to at most
// 2000px and re-encoded as JPEG so uploads stay fast and under the 5 MB limit.

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;
const COMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;
const MAX_DIMENSION = 2000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not a valid image.'));
    img.src = src;
  });
}

export async function readScreenshot(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Please choose a PNG, JPG, WEBP or GIF image.');
  const original = await readAsDataUrl(file);
  const img = await loadImage(original); // also proves it decodes as an image
  if (file.size <= COMPRESS_OVER_BYTES || file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error('Image is too large (max 5MB).');
    return original;
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', 0.85);
  if (out.length * 0.75 > MAX_BYTES) throw new Error('Image is too large even after compressing. Please crop it.');
  return out;
}
