/** Resolve an application-owned public path for root or GitHub Pages hosting.
 * Call once on the original /models, /audio, etc. path, before loading it.
 * glTF's relative buffers and textures then inherit the resolved parent URL.
 */
export function assetUrl(path: string, base = import.meta.env?.BASE_URL ?? '/'): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const prefix = (base || '/').replace(/\/?$/, '/');
  return prefix + path.slice(1);
}
