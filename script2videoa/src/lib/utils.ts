/**
 * Formats a filename based on cinematic naming rules:
 * [scene_order]_[semantic_keywords]_[media_id]
 */
export function formatCinematicFilename(
  sceneOrder: number,
  keywords: string[],
  mediaId: number,
  extension: string
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  // Clean keywords: lowercase, remove special chars, take top 8
  const cleanKeywords = keywords
    .map(k => k.toLowerCase()
      .normalize('NFD') // Remove accents
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .trim()
    )
    .filter(Boolean)
    .slice(0, 8)
    .join('_');

  return `${pad(sceneOrder)}_${cleanKeywords}_${mediaId}.${extension}`;
}

export async function downloadWithCustomName(url: string, filename: string) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('Download failed:', error);
    // Fallback: just open in new tab
    window.open(url, '_blank');
  }
}
