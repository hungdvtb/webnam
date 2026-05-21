export function parseProductVideoLinks(html) {
  if (!html) return '';

  return html.replace(
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=))[^\s<"']+)/gi,
    (match, url, offset, fullString) => {
      const before = fullString.substring(Math.max(0, offset - 10), offset).toLowerCase();

      if (before.includes('src=') || before.includes('href=')) {
        return match;
      }

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const idMatch = url.match(
          /(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/
        );

        if (idMatch) {
          return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="https://www.youtube.com/embed/${idMatch[1]}" allowfullscreen="true" frameborder="0" loading="lazy" style="width:100%; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
        }
      } else if (url.includes('facebook.com')) {
        const fbEmbed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
        return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="${fbEmbed}" allowfullscreen="true" frameborder="0" loading="lazy" style="width:800px; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
      }

      return match;
    }
  );
}

export function normalizeProductDescriptionHtml(html) {
  if (!html) return '';

  return html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/\u00A0/g, ' ');
}

export function buildProductDescriptionHtml(html) {
  return parseProductVideoLinks(normalizeProductDescriptionHtml(html || ''));
}
