const BLOCK_TAG_PATTERN = /<\s*\/?\s*(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|img|a|figure|blockquote|br|strong|em|iframe|video)\b/i;

const escapeHtml = (value = '') => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const stripCodeFence = (value = '') => String(value || '')
    .trim()
    .replace(/^```(?:html|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const normalizeUrlAttribute = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized || /^(javascript|vbscript|data):/i.test(normalized)) {
        return '';
    }
    return normalized;
};

const inlineMarkdownToHtml = (value = '') => {
    let html = escapeHtml(value);

    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
        const normalizedSrc = normalizeUrlAttribute(src);
        return normalizedSrc ? `<img src="${escapeHtml(normalizedSrc)}" alt="${escapeHtml(alt)}">` : '';
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const normalizedHref = normalizeUrlAttribute(href);
        return normalizedHref ? `<a href="${escapeHtml(normalizedHref)}">${escapeHtml(label)}</a>` : escapeHtml(label);
    });

    html = html
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+?)`/g, '<code>$1</code>');

    return html;
};

const splitMarkdownTableRow = (line = '') => String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const consumeMarkdownTable = (lines, startIndex) => {
    const headers = splitMarkdownTableRow(lines[startIndex]);
    const rows = [];
    let index = startIndex + 2;

    while (index < lines.length && /^\|(.+)\|$/.test(String(lines[index] || '').trim())) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
    }

    const thead = `<thead><tr>${headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;

    return {
        html: `<table>${thead}${tbody}</table>`,
        nextIndex: index - 1,
    };
};

const markdownToHtml = (value = '') => {
    const lines = stripCodeFence(value).split(/\r\n|\r|\n/);
    const parts = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];

    const flushParagraph = () => {
        const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
        if (text) {
            parts.push(`<p>${inlineMarkdownToHtml(text)}</p>`);
        }
        paragraph = [];
    };

    const flushList = () => {
        if (!listType || listItems.length === 0) return;
        parts.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join('')}</${listType}>`);
        listType = null;
        listItems = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = String(lines[index] || '').trim();

        if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
        }

        if (/^\|(.+)\|$/.test(trimmed) && /^\|[\s:\-|+]+\|$/.test(String(lines[index + 1] || '').trim())) {
            flushParagraph();
            flushList();
            const table = consumeMarkdownTable(lines, index);
            parts.push(table.html);
            index = table.nextIndex;
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const level = Math.min(Math.max(headingMatch[1].length, 2), 3);
            parts.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2])}</h${level}>`);
            continue;
        }

        const bulletMatch = trimmed.match(/^(?:[-*+])\s+(.+)$/);
        if (bulletMatch) {
            flushParagraph();
            if (listType !== 'ul') {
                flushList();
                listType = 'ul';
            }
            listItems.push(bulletMatch[1].trim());
            continue;
        }

        const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (orderedMatch) {
            flushParagraph();
            if (listType !== 'ol') {
                flushList();
                listType = 'ol';
            }
            listItems.push(orderedMatch[1].trim());
            continue;
        }

        const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imageMatch) {
            flushParagraph();
            flushList();
            const src = normalizeUrlAttribute(imageMatch[2]);
            if (src) {
                parts.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(imageMatch[1])}"></figure>`);
            }
            continue;
        }

        paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();

    return parts.join('\n');
};

const transformTextNodeMarkdown = (document, textNode) => {
    const text = textNode.nodeValue || '';
    if (!/(\*\*|__|\[[^\]]+\]\([^)]+\)|`)/.test(text)) {
        return;
    }

    const template = document.createElement('template');
    template.innerHTML = inlineMarkdownToHtml(text);
    textNode.replaceWith(template.content);
};

const sanitizeHtml = (html = '') => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return html;
    }

    const template = document.createElement('template');
    template.innerHTML = html;
    const blockedTags = ['script', 'style', 'noscript'];
    const allowedTags = new Set([
        'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'FIGCAPTION', 'FIGURE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IFRAME', 'IMG', 'LI', 'OL', 'P',
        'SOURCE', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR',
        'U', 'UL', 'VIDEO',
    ]);

    template.content.querySelectorAll(blockedTags.join(',')).forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
        if (['H1', 'H4', 'H5', 'H6'].includes(node.tagName)) {
            const replacement = document.createElement(node.tagName === 'H1' ? 'h2' : 'h3');
            Array.from(node.attributes).forEach((attribute) => {
                replacement.setAttribute(attribute.name, attribute.value);
            });
            replacement.innerHTML = node.innerHTML;
            node.replaceWith(replacement);
            node = replacement;
        }

        if (!allowedTags.has(node.tagName)) {
            node.replaceWith(...Array.from(node.childNodes));
            return;
        }

        Array.from(node.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value || '';
            const allowed = name.startsWith('data-')
                || name.startsWith('aria-')
                || ['class', 'style', 'title', 'alt', 'width', 'height', 'loading', 'target', 'rel', 'colspan', 'rowspan', 'src', 'srcset', 'href', 'poster', 'controls', 'frameborder', 'allow', 'allowfullscreen'].includes(name);

            if (name.startsWith('on') || !allowed) {
                node.removeAttribute(attribute.name);
                return;
            }

            if (['href', 'src', 'poster'].includes(name) && !normalizeUrlAttribute(value)) {
                node.removeAttribute(attribute.name);
            }
        });

        if (node.tagName === 'A' && node.hasAttribute('target') && !node.hasAttribute('rel')) {
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });

    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        const parentTag = walker.currentNode.parentElement?.tagName;
        if (!['SCRIPT', 'STYLE', 'PRE', 'CODE'].includes(parentTag)) {
            textNodes.push(walker.currentNode);
        }
    }
    textNodes.forEach((node) => transformTextNodeMarkdown(document, node));

    template.content.querySelectorAll('p').forEach((node) => {
        const text = node.textContent.trim();
        const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
        if (!headingMatch) return;
        const level = Math.min(Math.max(headingMatch[1].length, 2), 3);
        const heading = document.createElement(`h${level}`);
        heading.innerHTML = inlineMarkdownToHtml(headingMatch[2]);
        node.replaceWith(heading);
    });

    return template.innerHTML.trim();
};

export function normalizeBlogContentHtml(value = '') {
    const stripped = stripCodeFence(value);
    if (!stripped) {
        return '';
    }

    const html = BLOCK_TAG_PATTERN.test(stripped)
        ? stripped
        : markdownToHtml(stripped);

    return sanitizeHtml(html);
}
