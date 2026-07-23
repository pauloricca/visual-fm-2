export const USER_ZOOM_BASELINE = 0.5;

export function canvasHeaderTitleScale(zoom: number): number {
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : USER_ZOOM_BASELINE;
  const userZoom = normalizedZoom / USER_ZOOM_BASELINE;

  if (userZoom <= 0.3) return 2.2;
  if (userZoom <= 0.5) return 1.75;
  if (userZoom < 0.7) return 1.3;
  return 1;
}

export function graphDetailZoomScale(zoom: number): number {
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : USER_ZOOM_BASELINE;
  return normalizedZoom / USER_ZOOM_BASELINE;
}

export function graphDetailScreenEmphasis(zoomScale: number): number {
  const normalizedScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  if (normalizedScale <= 1) return 1;
  return Math.min(1.32, 1 + Math.log2(normalizedScale) * 0.16);
}
