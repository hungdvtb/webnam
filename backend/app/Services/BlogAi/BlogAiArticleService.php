<?php

namespace App\Services\BlogAi;

use App\Services\AI\GeminiService;
use Illuminate\Support\Str;

class BlogAiArticleService
{
    public function __construct(
        private readonly GeminiService $geminiService,
    ) {
    }

    public function generateArticle(array $payload, ?int $accountId = null, ?string $model = null): array
    {
        $context = $this->buildContext($payload);

        try {
            $result = $this->geminiService->generateText(
                $this->buildPrompt($context),
                $accountId,
                $model
            );

            $structured = $this->decodeStructuredResponse(
                $result['text'],
                $accountId,
                $result['model']
            );

            $normalized = $this->normalizeStructuredResponse($structured, $context);
            $normalized['used_ai'] = true;
            $normalized['model'] = $result['model'];

            return $normalized;
        } catch (\Throwable $exception) {
            $fallback = $this->buildFallbackArticle($context);
            $fallback['used_ai'] = false;
            $fallback['model'] = null;
            $fallback['warning'] = trim((string) $exception->getMessage());

            return $fallback;
        }
    }

    private function buildContext(array $payload): array
    {
        $primaryKeyword = $this->cleanText($payload['primary_keyword'] ?? '');
        $secondaryKeywords = collect((array) ($payload['secondary_keywords'] ?? []))
            ->map(fn ($item) => $this->cleanText($item))
            ->filter()
            ->unique(fn ($value) => Str::lower(Str::ascii((string) $value)))
            ->take(10)
            ->values()
            ->all();

        $clusterKeywords = collect((array) ($payload['cluster_keywords'] ?? []))
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                $keyword = $this->cleanText($item['keyword'] ?? '');
                if ($keyword === '') {
                    return null;
                }

                return [
                    'keyword' => $keyword,
                    'search_volume' => max((int) ($item['search_volume'] ?? 0), 0),
                ];
            })
            ->filter()
            ->take(20)
            ->values()
            ->all();

        $internalLinks = collect((array) ($payload['internal_links'] ?? []))
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                $url = trim((string) ($item['url'] ?? ''));
                $anchor = $this->cleanText($item['anchor'] ?? $item['title'] ?? '');
                $description = $this->cleanText($item['description'] ?? '');
                $type = $this->cleanText($item['type'] ?? 'reference');

                if ($url === '' || $anchor === '') {
                    return null;
                }

                return [
                    'type' => $type !== '' ? $type : 'reference',
                    'url' => $url,
                    'anchor' => $anchor,
                    'description' => $description,
                ];
            })
            ->filter()
            ->take(6)
            ->values()
            ->all();

        return [
            'primary_keyword' => $primaryKeyword !== '' ? $primaryKeyword : 'gom Bat Trang',
            'secondary_keywords' => $secondaryKeywords,
            'cluster_keywords' => $clusterKeywords,
            'intent_label' => $this->cleanText($payload['intent_label'] ?? 'Thong tin tham khao'),
            'topic_label' => $this->cleanText($payload['topic_label'] ?? $primaryKeyword),
            'suggested_category' => $this->cleanText($payload['suggested_category'] ?? 'Kien thuc gom su'),
            'industry_context' => $this->cleanText($payload['industry_context'] ?? ''),
            'keyword_volume_total' => max((int) ($payload['keyword_volume_total'] ?? 0), 0),
            'related_products' => $this->normalizeResourceList($payload['related_products'] ?? []),
            'related_product_categories' => $this->normalizeResourceList($payload['related_product_categories'] ?? []),
            'related_blog_categories' => $this->normalizeResourceList($payload['related_blog_categories'] ?? []),
            'internal_links' => $internalLinks,
            'inline_image_url' => trim((string) ($payload['inline_image_url'] ?? '')),
            'inline_image_alt' => $this->cleanText($payload['inline_image_alt'] ?? $primaryKeyword),
        ];
    }

    private function normalizeResourceList(mixed $input): array
    {
        return collect(is_array($input) ? $input : [])
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                $name = $this->cleanText($item['name'] ?? $item['title'] ?? '');
                $url = trim((string) ($item['url'] ?? ''));

                if ($name === '' || $url === '') {
                    return null;
                }

                return [
                    'name' => $name,
                    'url' => $url,
                ];
            })
            ->filter()
            ->take(6)
            ->values()
            ->all();
    }

    private function buildPrompt(array $context): string
    {
        $snapshot = [
            'primary_keyword' => $context['primary_keyword'],
            'secondary_keywords' => $context['secondary_keywords'],
            'cluster_keywords' => $context['cluster_keywords'],
            'intent_label' => $context['intent_label'],
            'topic_label' => $context['topic_label'],
            'suggested_category' => $context['suggested_category'],
            'industry_context' => $context['industry_context'],
            'keyword_volume_total' => $context['keyword_volume_total'],
            'related_products' => $context['related_products'],
            'related_product_categories' => $context['related_product_categories'],
            'related_blog_categories' => $context['related_blog_categories'],
            'internal_link_targets' => array_map(
                fn (array $item) => [
                    'type' => $item['type'],
                    'anchor' => $item['anchor'],
                    'url' => $item['url'],
                ],
                $context['internal_links']
            ),
        ];

        return "You are a Vietnamese SEO editor for Bat Trang ceramics, worship items, and ceramic gifts.\n"
            . "Write the article in natural Vietnamese.\n"
            . "Match the dominant search intent exactly.\n"
            . "Avoid keyword stuffing, repeated phrasing, vague filler, or robotic wording.\n"
            . "The CMS will build the final HTML, so return valid JSON only.\n"
            . "Keep the tone practical, concrete, and useful for real readers.\n"
            . "If the keyword cluster is about worship items, keep the wording respectful and contextually appropriate.\n"
            . "If the keyword cluster is about ceramic gifts, include practical selection/use-case advice.\n"
            . "If the keyword cluster is about Bat Trang ceramics in general, keep the content grounded in product choice, usage context, maintenance, and category guidance.\n\n"
            . "Hard rules:\n"
            . "1. title must be compelling and specific.\n"
            . "2. excerpt must be 1 to 2 sentences.\n"
            . "3. sections must contain 3 to 5 items.\n"
            . "4. Every section must have heading and 1 to 3 paragraphs.\n"
            . "5. list_items is optional, but when present it should contain 2 to 5 concise bullets.\n"
            . "6. faq must contain 2 to 4 relevant questions.\n"
            . "7. seo_title must contain the main keyword and stay concise.\n"
            . "8. seo_description must be specific and appealing, not generic.\n"
            . "9. seo_keywords must contain 4 to 8 relevant keywords.\n"
            . "10. category_name should support a long-term SEO content structure and should not be overly narrow.\n"
            . "11. image_brief must describe a context-appropriate cover image in 1 sentence.\n"
            . "12. Return JSON only. No markdown. No code fences. No explanation.\n\n"
            . "JSON schema:\n"
            . "{\n"
            . "  \"title\": \"...\",\n"
            . "  \"slug_hint\": \"...\",\n"
            . "  \"excerpt\": \"...\",\n"
            . "  \"seo_title\": \"...\",\n"
            . "  \"seo_description\": \"...\",\n"
            . "  \"seo_keywords\": [\"...\"],\n"
            . "  \"category_name\": \"...\",\n"
            . "  \"image_brief\": \"...\",\n"
            . "  \"sections\": [\n"
            . "    {\n"
            . "      \"heading\": \"...\",\n"
            . "      \"paragraphs\": [\"...\"],\n"
            . "      \"list_items\": [\"...\"]\n"
            . "    }\n"
            . "  ],\n"
            . "  \"faq\": [\n"
            . "    {\"question\": \"...\", \"answer\": \"...\"}\n"
            . "  ]\n"
            . "}\n\n"
            . "Content brief:\n"
            . json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    }

    private function decodeStructuredResponse(string $rawText, ?int $accountId, ?string $model): array
    {
        $candidate = $this->extractJsonCandidate($rawText);
        if ($candidate !== null) {
            try {
                return json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
            }
        }

        $repairPrompt = "Convert the following content into valid JSON only.\n"
            . "Do not add markdown or commentary.\n"
            . "Required keys: title, slug_hint, excerpt, seo_title, seo_description, seo_keywords, category_name, image_brief, sections, faq.\n\n"
            . "Content:\n{$rawText}";

        $repaired = $this->geminiService->generateText($repairPrompt, $accountId, $model);
        $repairedCandidate = $this->extractJsonCandidate($repaired['text']);

        if ($repairedCandidate === null) {
            throw new \RuntimeException('AI article response is not valid JSON.');
        }

        return json_decode($repairedCandidate, true, 512, JSON_THROW_ON_ERROR);
    }

    private function extractJsonCandidate(string $value): ?string
    {
        $trimmed = trim($value);
        $trimmed = preg_replace('/^```json\s*/i', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/^```\s*/', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/\s*```$/', '', $trimmed) ?? $trimmed;

        if ($trimmed === '') {
            return null;
        }

        $start = strpos($trimmed, '{');
        $end = strrpos($trimmed, '}');

        if ($start === false || $end === false || $end <= $start) {
            return null;
        }

        return substr($trimmed, $start, $end - $start + 1);
    }

    private function normalizeStructuredResponse(array $data, array $context): array
    {
        $title = $this->limitText(
            $this->cleanText($data['title'] ?? ''),
            255,
            $this->buildFallbackTitle($context)
        );

        $excerpt = $this->limitText(
            $this->cleanText($data['excerpt'] ?? ''),
            320,
            $this->buildFallbackExcerpt($context)
        );

        $seoTitle = $this->limitText(
            $this->cleanText($data['seo_title'] ?? ''),
            80,
            $title
        );

        $seoDescription = $this->limitText(
            $this->cleanText($data['seo_description'] ?? ''),
            180,
            $excerpt
        );

        $categoryName = $this->limitText(
            $this->cleanText($data['category_name'] ?? ''),
            120,
            $context['suggested_category']
        );

        $imageBrief = $this->limitText(
            $this->cleanText($data['image_brief'] ?? ''),
            220,
            $this->buildFallbackImageBrief($context)
        );

        $sections = $this->normalizeSections($data['sections'] ?? [], $context);
        $faq = $this->normalizeFaq($data['faq'] ?? [], $context);
        $seoKeywords = $this->normalizeKeywords($data['seo_keywords'] ?? [], $context);

        return [
            'title' => $title,
            'slug_hint' => $this->limitText(
                $this->cleanText($data['slug_hint'] ?? ''),
                160,
                $title
            ),
            'excerpt' => $excerpt,
            'meta_title' => $seoTitle,
            'meta_description' => $seoDescription,
            'meta_keywords' => implode(', ', $seoKeywords),
            'category_name' => $categoryName,
            'image_brief' => $imageBrief,
            'content_html' => $this->buildContentHtml($sections, $faq, $context),
        ];
    }

    private function normalizeSections(mixed $input, array $context): array
    {
        $sections = collect(is_array($input) ? $input : [])
            ->map(function ($item, int $index) use ($context) {
                if (!is_array($item)) {
                    return null;
                }

                $heading = $this->limitText(
                    $this->cleanText($item['heading'] ?? ''),
                    120,
                    $this->fallbackSectionHeading($context, $index)
                );

                $paragraphs = collect(is_array($item['paragraphs'] ?? null) ? $item['paragraphs'] : [])
                    ->map(fn ($paragraph) => $this->limitText($this->cleanText($paragraph), 600, ''))
                    ->filter()
                    ->take(3)
                    ->values()
                    ->all();

                $listItems = collect(is_array($item['list_items'] ?? null) ? $item['list_items'] : [])
                    ->map(fn ($line) => $this->limitText($this->cleanText($line), 220, ''))
                    ->filter()
                    ->take(5)
                    ->values()
                    ->all();

                if ($paragraphs === []) {
                    $paragraphs = $this->fallbackSectionParagraphs($context, $heading, $index);
                }

                return [
                    'heading' => $heading,
                    'paragraphs' => $paragraphs,
                    'list_items' => $listItems,
                ];
            })
            ->filter()
            ->take(5)
            ->values();

        if ($sections->count() < 3) {
            foreach ($this->buildFallbackSections($context) as $section) {
                $sections->push($section);
            }
        }

        return $sections
            ->unique(fn (array $item) => Str::lower(Str::ascii((string) ($item['heading'] ?? ''))))
            ->take(5)
            ->values()
            ->all();
    }

    private function normalizeFaq(mixed $input, array $context): array
    {
        $items = collect(is_array($input) ? $input : [])
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                $question = $this->limitText($this->cleanText($item['question'] ?? ''), 180, '');
                $answer = $this->limitText($this->cleanText($item['answer'] ?? ''), 420, '');

                if ($question === '' || $answer === '') {
                    return null;
                }

                return [
                    'question' => $question,
                    'answer' => $answer,
                ];
            })
            ->filter()
            ->take(4)
            ->values();

        if ($items->count() < 2) {
            foreach ($this->buildFallbackFaq($context) as $faq) {
                $items->push($faq);
            }
        }

        return $items
            ->unique(fn (array $item) => Str::lower(Str::ascii((string) ($item['question'] ?? ''))))
            ->take(4)
            ->values()
            ->all();
    }

    private function normalizeKeywords(mixed $input, array $context): array
    {
        $keywords = collect([]);

        if (is_array($input)) {
            foreach ($input as $item) {
                $keywords->push($this->cleanText($item));
            }
        } else {
            foreach (preg_split('/,|;|\n|\r/u', (string) $input) ?: [] as $item) {
                $keywords->push($this->cleanText($item));
            }
        }

        $keywords->push($context['primary_keyword']);
        foreach ($context['secondary_keywords'] as $item) {
            $keywords->push($this->cleanText($item));
        }
        $keywords->push($context['suggested_category']);

        return $keywords
            ->filter()
            ->map(fn ($item) => $this->limitText((string) $item, 80, ''))
            ->unique(fn ($item) => Str::lower(Str::ascii((string) $item)))
            ->take(8)
            ->values()
            ->all();
    }

    private function buildFallbackArticle(array $context): array
    {
        $title = $this->buildFallbackTitle($context);
        $excerpt = $this->buildFallbackExcerpt($context);

        return [
            'title' => $title,
            'slug_hint' => $title,
            'excerpt' => $excerpt,
            'meta_title' => $this->limitText($title, 80, $title),
            'meta_description' => $this->limitText($excerpt, 180, $excerpt),
            'meta_keywords' => implode(', ', $this->normalizeKeywords([], $context)),
            'category_name' => $context['suggested_category'],
            'image_brief' => $this->buildFallbackImageBrief($context),
            'content_html' => $this->buildContentHtml(
                $this->buildFallbackSections($context),
                $this->buildFallbackFaq($context),
                $context
            ),
        ];
    }

    private function buildContentHtml(array $sections, array $faq, array $context): string
    {
        $parts = [];

        if ($context['inline_image_url'] !== '') {
            $parts[] = '<p><img src="'
                . $this->escapeHtml($context['inline_image_url'])
                . '" alt="'
                . $this->escapeHtml($context['inline_image_alt'])
                . '" loading="lazy" /></p>';
        }

        foreach ($sections as $section) {
            $parts[] = '<h2>' . $this->escapeHtml((string) ($section['heading'] ?? '')) . '</h2>';

            foreach ((array) ($section['paragraphs'] ?? []) as $paragraph) {
                $parts[] = '<p>' . $this->escapeHtml((string) $paragraph) . '</p>';
            }

            $listItems = array_values(array_filter(array_map(
                fn ($item) => $this->cleanText($item),
                (array) ($section['list_items'] ?? [])
            )));

            if ($listItems !== []) {
                $parts[] = '<ul>' . implode('', array_map(
                    fn (string $item) => '<li>' . $this->escapeHtml($item) . '</li>',
                    $listItems
                )) . '</ul>';
            }
        }

        if ($faq !== []) {
            $parts[] = '<h2>Cau hoi thuong gap</h2>';

            foreach ($faq as $item) {
                $parts[] = '<h3>' . $this->escapeHtml((string) ($item['question'] ?? '')) . '</h3>';
                $parts[] = '<p>' . $this->escapeHtml((string) ($item['answer'] ?? '')) . '</p>';
            }
        }

        if ($context['internal_links'] !== []) {
            $parts[] = '<h2>Goi y lien quan</h2>';
            $parts[] = '<ul>' . implode('', array_map(function (array $link) {
                $description = trim((string) ($link['description'] ?? ''));
                $label = $description !== ''
                    ? $description
                    : $this->defaultLinkDescription($link);

                return '<li><a href="'
                    . $this->escapeHtml((string) ($link['url'] ?? ''))
                    . '">'
                    . $this->escapeHtml((string) ($link['anchor'] ?? ''))
                    . '</a> - '
                    . $this->escapeHtml($label)
                    . '</li>';
            }, $context['internal_links'])) . '</ul>';
        }

        return implode("\n", array_filter($parts));
    }

    private function defaultLinkDescription(array $link): string
    {
        return match ($link['type'] ?? '') {
            'product' => 'San pham phu hop de doi chieu mau men, cong nang va cach phoi bo cuc.',
            'product_category' => 'Danh muc lien quan de mo rong lua chon theo cung chu de.',
            'blog_category' => 'Chuyen muc bai viet lien quan de doc them cac noi dung cung huong tim kiem.',
            default => 'Thong tin lien quan phu hop voi chu de dang tim hieu.',
        };
    }

    private function buildFallbackTitle(array $context): string
    {
        return Str::of($context['primary_keyword'])
            ->replaceMatches('/\s+/u', ' ')
            ->trim()
            ->ucfirst()
            ->value()
            . ': cach chon va ung dung phu hop';
    }

    private function buildFallbackExcerpt(array $context): string
    {
        $intent = Str::lower(Str::ascii($context['intent_label']));

        if (str_contains($intent, 'gia') || str_contains($intent, 'mua')) {
            return "Bai viet tong hop cach danh gia {$context['primary_keyword']}, nhung diem can so sanh va huong chon theo dung nhu cau thuc te.";
        }

        if (str_contains($intent, 'so sanh')) {
            return "Bai viet giup ban doi chieu {$context['primary_keyword']} theo cac tieu chi quan trong de tranh chon nham va tranh trung y giua cac nhom san pham.";
        }

        return "Bai viet giup ban hieu ro {$context['primary_keyword']}, cach chon dung theo boi canh su dung va cac goi y lien quan trong nganh gom su Bat Trang.";
    }

    private function buildFallbackImageBrief(array $context): string
    {
        return "Anh bia phong cach bien tap gom su Bat Trang, nhan vao {$context['topic_label']} va boi canh su dung phu hop voi bai viet.";
    }

    private function buildFallbackSections(array $context): array
    {
        $primaryKeyword = $context['primary_keyword'];
        $usageContext = $this->resolveUsageContext($context);
        $selectionFocus = $this->resolveSelectionFocus($context);

        return [
            [
                'heading' => "Tong quan ve {$primaryKeyword}",
                'paragraphs' => [
                    "{$primaryKeyword} thuong duoc tim kiem khi nguoi dung can mot huong dan ro rang ve cach chon, cach dung hoac cach phan biet trong nhom gom su Bat Trang.",
                    "Khi xet dung search intent, dieu quan trong khong nam o viec liet ke that nhieu thong tin, ma la lam ro mon do phu hop voi {$usageContext} va muc dich su dung cu the.",
                ],
                'list_items' => [],
            ],
            [
                'heading' => 'Nhung diem can xem ky truoc khi chon',
                'paragraphs' => [
                    "De tranh mua theo cam tinh, nen doi chieu {$selectionFocus} cung bo cuc tong the, men su, hoa tiet va muc do dong bo voi khong gian su dung.",
                    "Voi nhom san pham lien quan den do tho hoac qua tang, can uu tien tinh phu hop ve ngu canh va cach trinh bay hon la chi nhin vao hinh anh san pham don le.",
                ],
                'list_items' => [
                    'Uu tien mon do co bo cuc va kich thuoc phu hop voi khong gian dat.',
                    'Doi chieu men, hoa tiet va tong mau voi mon do dang co san.',
                    'Neu mua de tang hoac trung bay, can tinh den muc do dong bo va thong diep muon truyen tai.',
                ],
            ],
            [
                'heading' => 'Goi y ung dung va mo rong lua chon',
                'paragraphs' => [
                    "Thay vi xem tung tu khoa rieng le, nen nhin {$primaryKeyword} nhu mot cum chu de co lien he den danh muc san pham, bai viet huong dan va nhung goi y bo sung gan nghia.",
                    "Cach tiep can nay giup noi dung tranh trung lap, giam cannibalization va de tao thanh mot cau truc SEO ben vung hon cho website.",
                ],
                'list_items' => [
                    'Ket hop bai huong dan voi danh muc va san pham lien quan thay vi tach thanh nhieu bai cung y.',
                    'Uu tien internal link den nhung trang that su mo rong gia tri cho nguoi doc.',
                ],
            ],
        ];
    }

    private function buildFallbackFaq(array $context): array
    {
        return [
            [
                'question' => "{$context['primary_keyword']} nen duoc chon theo tieu chi nao?",
                'answer' => 'Nen uu tien dung nhu cau, bo cuc khong gian, do dong bo voi cac mon lien quan va muc do phu hop voi ngu canh su dung truoc khi quyet dinh.',
            ],
            [
                'question' => 'Co nen tach moi tu khoa thanh mot bai rieng khong?',
                'answer' => 'Khong nen tach may moc. Nhung tu khoa gan nghia va cung search intent nen duoc gom thanh mot bai de tranh trung y va tranh cannibalization.',
            ],
            [
                'question' => 'Khi nao nen chen internal link trong bai?',
                'answer' => 'Chi nen chen khi trang dich thuc su lien quan va giup nguoi doc di tiep mot buoc tu nhien trong hanh trinh tim hieu hoac mua hang.',
            ],
        ];
    }

    private function fallbackSectionHeading(array $context, int $index): string
    {
        return match ($index) {
            0 => "Tong quan ve {$context['primary_keyword']}",
            1 => 'Nhung diem can luu y',
            2 => 'Goi y chon va ung dung',
            default => 'Noi dung lien quan',
        };
    }

    private function fallbackSectionParagraphs(array $context, string $heading, int $index): array
    {
        $fallback = $this->buildFallbackSections($context);

        return $fallback[$index]['paragraphs'] ?? [
            "{$heading} can duoc trinh bay theo huong ro search intent, tap trung vao thong tin giup nguoi doc ra quyet dinh nhanh hon va dung hon.",
        ];
    }

    private function resolveUsageContext(array $context): string
    {
        $haystack = Str::lower(Str::ascii(
            $context['primary_keyword'] . ' ' . $context['topic_label'] . ' ' . $context['suggested_category']
        ));

        return match (true) {
            str_contains($haystack, 'do tho'), str_contains($haystack, 'tho cung'), str_contains($haystack, 'bat huong') => 'khong gian tho cung',
            str_contains($haystack, 'qua tang'), str_contains($haystack, 'in logo'), str_contains($haystack, 'doanh nghiep') => 'qua tang doanh nghiep hoac qua bieu',
            default => 'khong gian trung bay, su dung hoac tim hieu san pham',
        };
    }

    private function resolveSelectionFocus(array $context): string
    {
        $haystack = Str::lower(Str::ascii($context['primary_keyword'] . ' ' . $context['topic_label']));

        return match (true) {
            str_contains($haystack, 'loc binh'), str_contains($haystack, 'binh') => 'kieu dang, hoa tiet va ty le dat trong khong gian',
            str_contains($haystack, 'do tho'), str_contains($haystack, 'bat huong'), str_contains($haystack, 'chan nen') => 'kich thuoc, su dong bo va tinh trang nghiem',
            str_contains($haystack, 'qua tang') => 'muc dich tang, thong diep va cach dong bo bo qua',
            default => 'chat lieu, men su, hoa tiet va ngu canh su dung',
        };
    }

    private function cleanText(mixed $value): string
    {
        $normalized = html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function limitText(string $value, int $limit, string $fallback): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $fallback;
        }

        return trim(Str::limit($trimmed, $limit, ''));
    }

    private function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
