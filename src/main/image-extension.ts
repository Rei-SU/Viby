/** Container extension for a fetched image, from its content type or URL. */
export function extensionFor(contentType: string, url: string): string {
  const type = contentType.split(';')[0]?.trim().toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/gif') return 'gif'
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg'
  const fromUrl = /\.(jpe?g|png|webp|gif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase()
  return fromUrl === 'jpeg' ? 'jpg' : (fromUrl ?? 'jpg')
}
