// Draws the home-screen icons for the installable app from the shop's logo.
// The server has no image library, so the browser does it once when the logo is saved.

export type AppIcons = { "app.icon192": string; "app.icon512": string; "app.iconMaskable": string; "app.iconApple": string };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid"));
    image.src = src;
  });
}

/** Draws the logo centered in a square, scaled to `fill` of the side, over `background` (or transparent). */
function draw(image: HTMLImageElement, size: number, fill: number, background: string | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("invalid");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
  }
  const box = size * fill;
  const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL("image/png");
}

export async function makeAppIcons(logoDataUrl: string, background: string): Promise<AppIcons> {
  const image = await loadImage(logoDataUrl);
  return {
    "app.icon192": draw(image, 192, 0.92, null),
    "app.icon512": draw(image, 512, 0.92, null),
    // Android may crop to a circle: keep the logo inside the central safe zone.
    "app.iconMaskable": draw(image, 512, 0.66, background),
    // iOS shows transparency as black, so always use a solid background.
    "app.iconApple": draw(image, 180, 0.8, background),
  };
}

export const emptyAppIcons: AppIcons = { "app.icon192": "", "app.icon512": "", "app.iconMaskable": "", "app.iconApple": "" };
