const INLINE_IMAGE_ATTRIBUTES = ['alt', 'title', 'width', 'height'];

function normalizeInlineImageText(value) {
    return String(value || '').trim();
}

function applyInlineImageAttribute(node, attribute, value) {
    const normalizedValue = normalizeInlineImageText(value);

    if (!normalizedValue) {
        node.removeAttribute(attribute);
        return;
    }

    node.setAttribute(attribute, normalizedValue);
}

export function readInlineImageAttributes(node) {
    return {
        src: normalizeInlineImageText(node?.getAttribute?.('src')),
        alt: normalizeInlineImageText(node?.getAttribute?.('alt')),
        title: normalizeInlineImageText(node?.getAttribute?.('title')),
        width: normalizeInlineImageText(node?.getAttribute?.('width')),
        height: normalizeInlineImageText(node?.getAttribute?.('height')),
    };
}

export function registerBlogInlineImageBlot(Quill) {
    if (!Quill || globalThis.__blogInlineImageBlotRegistered) {
        return;
    }

    const BaseImage = Quill.import('formats/image');

    class BlogInlineImageBlot extends BaseImage {
        static create(value) {
            const sourceValue = typeof value === 'object' ? value?.src : value;
            const node = super.create(sourceValue);

            if (value && typeof value === 'object') {
                INLINE_IMAGE_ATTRIBUTES.forEach((attribute) => {
                    applyInlineImageAttribute(node, attribute, value?.[attribute]);
                });
            }

            return node;
        }

        static formats(domNode) {
            const formats = typeof super.formats === 'function'
                ? super.formats(domNode) || {}
                : {};

            INLINE_IMAGE_ATTRIBUTES.forEach((attribute) => {
                const attributeValue = normalizeInlineImageText(domNode?.getAttribute?.(attribute));
                if (attributeValue) {
                    formats[attribute] = attributeValue;
                }
            });

            return formats;
        }

        format(name, value) {
            if (INLINE_IMAGE_ATTRIBUTES.includes(name)) {
                applyInlineImageAttribute(this.domNode, name, value);
                return;
            }

            super.format(name, value);
        }
    }

    Quill.register(BlogInlineImageBlot, true);
    globalThis.__blogInlineImageBlotRegistered = true;
}
