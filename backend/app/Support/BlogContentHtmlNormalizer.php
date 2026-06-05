<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMText;
use DOMXPath;
use Throwable;

class BlogContentHtmlNormalizer
{
    private const ALLOWED_TAGS = [
        'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption', 'figure',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p',
        'source', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr',
        'u', 'ul', 'video',
    ];

    private const VOID_TAGS = ['br', 'hr', 'img', 'source'];

    public static function normalize(string $content): string
    {
        $content = self::stripCodeFence(trim($content));

        if ($content === '') {
            return '';
        }

        $html = self::looksLikeHtml($content)
            ? $content
            : self::markdownToHtml($content);

        $html = self::normalizeHtmlMarkdownText($html);

        return self::sanitizeHtml($html);
    }

    public static function markdownToHtml(string $markdown): string
    {
        $markdown = self::stripCodeFence(trim($markdown));
        if ($markdown === '') {
            return '';
        }

        $lines = preg_split('/\r\n|\r|\n/', $markdown) ?: [];
        $parts = [];
        $paragraph = [];
        $listType = null;
        $listItems = [];

        $flushParagraph = static function () use (&$parts, &$paragraph): void {
            if ($paragraph === []) {
                return;
            }

            $text = preg_replace('/\s+/u', ' ', trim(implode(' ', $paragraph))) ?? trim(implode(' ', $paragraph));
            if ($text !== '') {
                $parts[] = '<p>' . self::inlineMarkdownToHtml($text) . '</p>';
            }
            $paragraph = [];
        };

        $flushList = static function () use (&$parts, &$listType, &$listItems): void {
            if ($listType === null || $listItems === []) {
                return;
            }

            $parts[] = '<' . $listType . '>' . implode('', array_map(
                static fn (string $item): string => '<li>' . self::inlineMarkdownToHtml($item) . '</li>',
                $listItems
            )) . '</' . $listType . '>';
            $listType = null;
            $listItems = [];
        };

        for ($index = 0; $index < count($lines); $index++) {
            $line = rtrim((string) $lines[$index]);
            $trimmed = trim($line);

            if ($trimmed === '') {
                $flushParagraph();
                $flushList();
                continue;
            }

            if (preg_match('/^\|(.+)\|$/', $trimmed) === 1
                && isset($lines[$index + 1])
                && preg_match('/^\|[\s:\-|\+]+\|$/', trim((string) $lines[$index + 1])) === 1) {
                $flushParagraph();
                $flushList();
                [$tableHtml, $nextIndex] = self::consumeMarkdownTable($lines, $index);
                if ($tableHtml !== '') {
                    $parts[] = $tableHtml;
                    $index = $nextIndex;
                    continue;
                }
            }

            if (preg_match('/^(#{1,6})\s+(.+)$/u', $trimmed, $matches) === 1) {
                $flushParagraph();
                $flushList();
                $level = min(max(strlen($matches[1]), 2), 3);
                $parts[] = '<h' . $level . '>' . self::inlineMarkdownToHtml($matches[2]) . '</h' . $level . '>';
                continue;
            }

            if (preg_match('/^(?:[-*+])\s+(.+)$/u', $trimmed, $matches) === 1) {
                $flushParagraph();
                if ($listType !== 'ul') {
                    $flushList();
                    $listType = 'ul';
                }
                $listItems[] = trim($matches[1]);
                continue;
            }

            if (preg_match('/^\d+[.)]\s+(.+)$/u', $trimmed, $matches) === 1) {
                $flushParagraph();
                if ($listType !== 'ol') {
                    $flushList();
                    $listType = 'ol';
                }
                $listItems[] = trim($matches[1]);
                continue;
            }

            if (preg_match('/^!\[([^\]]*)\]\(([^)]+)\)$/u', $trimmed, $matches) === 1) {
                $flushParagraph();
                $flushList();
                $src = self::normalizeUrlAttribute($matches[2]);
                if ($src !== '') {
                    $parts[] = '<figure><img src="' . self::escapeHtml($src) . '" alt="' . self::escapeHtml($matches[1]) . '"></figure>';
                }
                continue;
            }

            $paragraph[] = $trimmed;
        }

        $flushParagraph();
        $flushList();

        return implode("\n", $parts);
    }

    private static function normalizeHtmlMarkdownText(string $html): string
    {
        return self::transformHtml($html, static function (DOMDocument $dom, DOMXPath $xpath): void {
            foreach ($xpath->query('//p') ?: [] as $paragraph) {
                if (!$paragraph instanceof DOMElement) {
                    continue;
                }

                $text = trim($paragraph->textContent ?? '');
                if (preg_match('/^(#{1,6})\s+(.+)$/u', $text, $matches) === 1) {
                    $level = min(max(strlen($matches[1]), 2), 3);
                    $heading = $dom->createElement('h' . $level);
                    $heading->appendChild(self::inlineMarkdownToFragment($dom, $matches[2]));
                    $paragraph->parentNode?->replaceChild($heading, $paragraph);
                }
            }

            $textNodes = [];
            foreach ($xpath->query('//text()[contains(., "**") or contains(., "__") or contains(., "[") or contains(., "`")]') ?: [] as $node) {
                if (!$node instanceof DOMText || self::hasAncestorTag($node, ['script', 'style', 'pre', 'code'])) {
                    continue;
                }
                $textNodes[] = $node;
            }

            foreach ($textNodes as $textNode) {
                $fragment = self::inlineMarkdownToFragment($dom, $textNode->nodeValue ?? '');
                $textNode->parentNode?->replaceChild($fragment, $textNode);
            }
        });
    }

    private static function sanitizeHtml(string $html): string
    {
        return self::transformHtml($html, static function (DOMDocument $dom, DOMXPath $xpath): void {
            $nodes = [];
            foreach ($xpath->query('//*') ?: [] as $node) {
                if ($node instanceof DOMElement && $node->getAttribute('id') !== '__blog_content_root__') {
                    $nodes[] = $node;
                }
            }

            foreach (array_reverse($nodes) as $node) {
                $tag = strtolower($node->tagName);

                if (in_array($tag, ['script', 'style', 'noscript'], true)) {
                    $node->parentNode?->removeChild($node);
                    continue;
                }

                if (in_array($tag, ['h1', 'h4', 'h5', 'h6'], true)) {
                    $node = self::renameNode($dom, $node, $tag === 'h1' ? 'h2' : 'h3');
                    $tag = strtolower($node->tagName);
                }

                if (!in_array($tag, self::ALLOWED_TAGS, true)) {
                    self::unwrapNode($node);
                    continue;
                }

                self::sanitizeAttributes($node);
            }
        });
    }

    private static function transformHtml(string $html, callable $transformer): string
    {
        $wrapped = '<div id="__blog_content_root__">' . $html . '</div>';
        $dom = new DOMDocument('1.0', 'UTF-8');
        $options = (defined('LIBXML_HTML_NOIMPLIED') ? LIBXML_HTML_NOIMPLIED : 0)
            | (defined('LIBXML_HTML_NODEFDTD') ? LIBXML_HTML_NODEFDTD : 0)
            | LIBXML_NOERROR
            | LIBXML_NOWARNING;

        $previousState = libxml_use_internal_errors(true);

        try {
            $encoded = mb_encode_numericentity($wrapped, [0x80, 0x10FFFF, 0, ~0], 'UTF-8');
            $dom->loadHTML('<?xml encoding="utf-8" ?>' . $encoded, $options);
            $xpath = new DOMXPath($dom);
            $transformer($dom, $xpath);
            $root = $xpath->query('//*[@id="__blog_content_root__"]')->item(0);
            $result = $root instanceof DOMNode ? self::innerHtml($root) : $html;
        } catch (Throwable) {
            $result = $html;
        }

        libxml_clear_errors();
        libxml_use_internal_errors($previousState);

        return trim($result);
    }

    private static function inlineMarkdownToHtml(string $text): string
    {
        $dom = new DOMDocument('1.0', 'UTF-8');
        $fragment = self::inlineMarkdownToFragment($dom, $text);

        $html = '';
        foreach (iterator_to_array($fragment->childNodes) as $child) {
            $html .= $dom->saveHTML($child);
        }

        return $html;
    }

    private static function inlineMarkdownToFragment(DOMDocument $dom, string $text): \DOMDocumentFragment
    {
        $fragment = $dom->createDocumentFragment();
        $pattern = '/(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`)/u';
        $offset = 0;

        preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE);

        foreach ($matches[0] ?? [] as $match) {
            [$token, $position] = $match;
            if ($position > $offset) {
                $fragment->appendChild($dom->createTextNode(substr($text, $offset, $position - $offset)));
            }

            self::appendInlineToken($dom, $fragment, $token);
            $offset = $position + strlen($token);
        }

        if ($offset < strlen($text)) {
            $fragment->appendChild($dom->createTextNode(substr($text, $offset)));
        }

        return $fragment;
    }

    private static function appendInlineToken(DOMDocument $dom, \DOMDocumentFragment $fragment, string $token): void
    {
        if (preg_match('/^!\[([^\]]*)\]\(([^)]+)\)$/u', $token, $matches) === 1) {
            $src = self::normalizeUrlAttribute($matches[2]);
            if ($src !== '') {
                $image = $dom->createElement('img');
                $image->setAttribute('src', $src);
                $image->setAttribute('alt', trim($matches[1]));
                $fragment->appendChild($image);
                return;
            }
        }

        if (preg_match('/^\[([^\]]+)\]\(([^)]+)\)$/u', $token, $matches) === 1) {
            $href = self::normalizeUrlAttribute($matches[2]);
            if ($href !== '') {
                $link = $dom->createElement('a');
                $link->setAttribute('href', $href);
                $link->appendChild($dom->createTextNode($matches[1]));
                $fragment->appendChild($link);
                return;
            }
        }

        if ((str_starts_with($token, '**') && str_ends_with($token, '**'))
            || (str_starts_with($token, '__') && str_ends_with($token, '__'))) {
            $strong = $dom->createElement('strong');
            $strong->appendChild($dom->createTextNode(substr($token, 2, -2)));
            $fragment->appendChild($strong);
            return;
        }

        if (str_starts_with($token, '`') && str_ends_with($token, '`')) {
            $code = $dom->createElement('code');
            $code->appendChild($dom->createTextNode(substr($token, 1, -1)));
            $fragment->appendChild($code);
            return;
        }

        $fragment->appendChild($dom->createTextNode($token));
    }

    private static function consumeMarkdownTable(array $lines, int $startIndex): array
    {
        $headerCells = self::splitMarkdownTableRow((string) $lines[$startIndex]);
        if ($headerCells === []) {
            return ['', $startIndex];
        }

        $rows = [];
        $index = $startIndex + 2;
        while ($index < count($lines) && preg_match('/^\|(.+)\|$/', trim((string) $lines[$index])) === 1) {
            $rows[] = self::splitMarkdownTableRow((string) $lines[$index]);
            $index++;
        }

        $thead = '<thead><tr>' . implode('', array_map(
            static fn (string $cell): string => '<th>' . self::inlineMarkdownToHtml($cell) . '</th>',
            $headerCells
        )) . '</tr></thead>';
        $tbody = '<tbody>' . implode('', array_map(
            static fn (array $row): string => '<tr>' . implode('', array_map(
                static fn (string $cell): string => '<td>' . self::inlineMarkdownToHtml($cell) . '</td>',
                $row
            )) . '</tr>',
            $rows
        )) . '</tbody>';

        return ['<table>' . $thead . $tbody . '</table>', $index - 1];
    }

    private static function splitMarkdownTableRow(string $line): array
    {
        $line = trim($line);
        $line = trim($line, '|');

        return array_map('trim', explode('|', $line));
    }

    private static function sanitizeAttributes(DOMElement $node): void
    {
        $tag = strtolower($node->tagName);
        $allowed = [
            'class', 'style', 'title', 'alt', 'width', 'height', 'loading', 'target', 'rel',
            'colspan', 'rowspan', 'src', 'srcset', 'href', 'poster', 'controls', 'frameborder',
            'allow', 'allowfullscreen',
        ];

        foreach (iterator_to_array($node->attributes ?? []) as $attribute) {
            $name = strtolower($attribute->name);
            $value = trim((string) $attribute->value);

            if (str_starts_with($name, 'on')) {
                $node->removeAttribute($attribute->name);
                continue;
            }

            if (!in_array($name, $allowed, true) && !str_starts_with($name, 'data-') && !str_starts_with($name, 'aria-')) {
                $node->removeAttribute($attribute->name);
                continue;
            }

            if (in_array($name, ['href', 'src', 'poster'], true)) {
                $normalized = self::normalizeUrlAttribute($value);
                if ($normalized === '') {
                    $node->removeAttribute($attribute->name);
                    continue;
                }
                $node->setAttribute($attribute->name, $normalized);
            }
        }

        if ($tag === 'a' && $node->hasAttribute('target') && !$node->hasAttribute('rel')) {
            $node->setAttribute('rel', 'noopener noreferrer');
        }
    }

    private static function normalizeUrlAttribute(string $value): string
    {
        $value = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($value === '') {
            return '';
        }

        if (preg_match('/^(javascript|vbscript|data):/i', $value) === 1) {
            return '';
        }

        return $value;
    }

    private static function unwrapNode(DOMElement $node): void
    {
        $parent = $node->parentNode;
        if (!$parent) {
            return;
        }

        while ($node->firstChild) {
            $parent->insertBefore($node->firstChild, $node);
        }

        $parent->removeChild($node);
    }

    private static function renameNode(DOMDocument $dom, DOMElement $node, string $tagName): DOMElement
    {
        $replacement = $dom->createElement($tagName);

        foreach (iterator_to_array($node->attributes ?? []) as $attribute) {
            $replacement->setAttribute($attribute->name, $attribute->value);
        }

        while ($node->firstChild) {
            $replacement->appendChild($node->firstChild);
        }

        $node->parentNode?->replaceChild($replacement, $node);

        return $replacement;
    }

    private static function innerHtml(DOMNode $node): string
    {
        $html = '';
        foreach ($node->childNodes as $child) {
            $html .= $node->ownerDocument?->saveHTML($child) ?? '';
        }

        return $html;
    }

    private static function hasAncestorTag(DOMNode $node, array $tags): bool
    {
        $parent = $node->parentNode;
        while ($parent instanceof DOMElement) {
            if (in_array(strtolower($parent->tagName), $tags, true)) {
                return true;
            }
            $parent = $parent->parentNode;
        }

        return false;
    }

    private static function looksLikeHtml(string $value): bool
    {
        return preg_match('/<\s*\/?\s*(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|img|a|figure|blockquote|br|strong|em|iframe|video)\b/i', $value) === 1;
    }

    private static function stripCodeFence(string $value): string
    {
        $value = trim($value);
        $value = preg_replace('/^```(?:html|markdown|md)?\s*/i', '', $value) ?? $value;
        $value = preg_replace('/\s*```$/', '', $value) ?? $value;

        return trim($value);
    }

    private static function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
