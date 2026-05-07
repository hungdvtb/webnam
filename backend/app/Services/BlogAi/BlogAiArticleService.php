<?php

namespace App\Services\BlogAi;

use App\Services\AI\GeminiService;
use Illuminate\Support\Str;

class BlogAiArticleService
{
    public const BATCH_ARTICLE_COUNT = 5;
    public const MIN_ARTICLE_CHARACTERS = 3000;
    public const MAX_ARTICLE_CHARACTERS = 5000;

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

    public function generateArticlesBatch(array $payloads, ?int $accountId = null, ?string $model = null): array
    {
        $contexts = collect($payloads)
            ->map(fn ($payload) => $this->buildContext(is_array($payload) ? $payload : []))
            ->values()
            ->all();

        if ($contexts === []) {
            return [];
        }

        try {
            $result = $this->geminiService->generateText(
                $this->buildBatchPrompt($contexts),
                $accountId,
                $model
            );

            $structuredArticles = $this->decodeBatchStructuredResponse(
                $result['text'],
                $contexts,
                $accountId,
                $result['model']
            );

            return array_map(function (array $context, int $index) use ($structuredArticles, $result) {
                $structured = $structuredArticles[$index] ?? null;
                if (!is_array($structured)) {
                    $fallback = $this->buildFallbackArticle($context);
                    $fallback['used_ai'] = false;
                    $fallback['model'] = null;
                    $fallback['warning'] = 'AI không trả về bài hợp lệ trong batch.';

                    return $fallback;
                }

                $normalized = $this->normalizeStructuredResponse($structured, $context);
                $normalized['used_ai'] = true;
                $normalized['model'] = $result['model'];

                return $normalized;
            }, $contexts, array_keys($contexts));
        } catch (\Throwable $exception) {
            return array_map(function (array $context) use ($exception) {
                $fallback = $this->buildFallbackArticle($context);
                $fallback['used_ai'] = false;
                $fallback['model'] = null;
                $fallback['warning'] = trim((string) $exception->getMessage());

                return $fallback;
            }, $contexts);
        }
    }

    private function buildContext(array $payload): array
    {
        $primaryKeyword = $this->restoreCommonVietnameseDiacritics(
            $this->cleanText($payload['primary_keyword'] ?? '')
        );
        $secondaryKeywords = collect((array) ($payload['secondary_keywords'] ?? []))
            ->map(fn ($item) => $this->restoreCommonVietnameseDiacritics($this->cleanText($item)))
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

                $keyword = $this->restoreCommonVietnameseDiacritics(
                    $this->cleanText($item['keyword'] ?? '')
                );
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
            'primary_keyword' => $primaryKeyword !== '' ? $primaryKeyword : 'gốm Bát Tràng',
            'secondary_keywords' => $secondaryKeywords,
            'cluster_keywords' => $clusterKeywords,
            'intent_label' => $this->cleanText($payload['intent_label'] ?? 'Thông tin tham khảo'),
            'topic_label' => $this->restoreCommonVietnameseDiacritics($this->cleanText($payload['topic_label'] ?? $primaryKeyword)),
            'suggested_category' => $this->restoreCommonVietnameseDiacritics($this->cleanText($payload['suggested_category'] ?? 'Kiến thức gốm sứ')),
            'industry_context' => $this->restoreCommonVietnameseDiacritics($this->cleanText($payload['industry_context'] ?? '')),
            'keyword_volume_total' => max((int) ($payload['keyword_volume_total'] ?? 0), 0),
            'related_products' => $this->normalizeResourceList($payload['related_products'] ?? []),
            'related_product_categories' => $this->normalizeResourceList($payload['related_product_categories'] ?? []),
            'related_blog_categories' => $this->normalizeResourceList($payload['related_blog_categories'] ?? []),
            'internal_links' => $internalLinks,
            'inline_image_url' => trim((string) ($payload['inline_image_url'] ?? '')),
            'inline_image_alt' => $this->restoreCommonVietnameseDiacritics($this->cleanText($payload['inline_image_alt'] ?? $primaryKeyword)),
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
            . "Use Vietnamese with full diacritics only. Do not write Vietnamese without accents.\n"
            . "Match the dominant search intent exactly.\n"
            . "Avoid keyword stuffing, repeated phrasing, vague filler, robotic wording, and reusable template headings.\n"
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
            . "10. category_name must be Vietnamese with full diacritics, support a long-term SEO content structure, and should not be overly narrow.\n"
            . "11. image_brief must describe a context-appropriate cover image in 1 sentence.\n"
            . "12. Main article content must be between " . self::MIN_ARTICLE_CHARACTERS . " and " . self::MAX_ARTICLE_CHARACTERS . " Vietnamese characters.\n"
            . "13. Return JSON only. No markdown. No code fences. No explanation.\n\n"
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

    private function buildBatchPrompt(array $contexts): string
    {
        $items = [];

        foreach ($contexts as $index => $context) {
            $items[] = array_merge(
                [
                    'input_id' => 'article_' . ($index + 1),
                    'style_profile' => $this->articleStyleProfile($context, $index),
                ],
                $this->buildArticleSnapshot($context)
            );
        }

        $payload = [
            'article_count' => count($items),
            'min_characters_per_article' => self::MIN_ARTICLE_CHARACTERS,
            'max_characters_per_article' => self::MAX_ARTICLE_CHARACTERS,
            'items' => $items,
        ];

        return "Bạn là biên tập viên SEO tiếng Việt cho gốm Bát Tràng, đồ thờ và quà tặng gốm sứ.\n"
            . "Nhiệm vụ: viết nhiều bài trong một lần trả lời, mỗi input tạo đúng một bài riêng.\n"
            . "Bắt buộc viết 100% bằng tiếng Việt có dấu. Không dùng tiếng Việt không dấu.\n"
            . "Mỗi bài phải có nội dung riêng theo keyword, search intent, nhóm sản phẩm và style_profile của chính bài đó.\n"
            . "Không dùng chung một khung lặp lại cho mọi bài; không lặp các heading kiểu 'Giới thiệu chung', 'Giá trị cốt lõi', 'Phân tích chi tiết và ứng dụng' cho tất cả bài.\n"
            . "Mỗi bài dài từ " . self::MIN_ARTICLE_CHARACTERS . " đến " . self::MAX_ARTICLE_CHARACTERS . " ký tự tiếng Việt ở phần nội dung chính, chưa tính JSON.\n"
            . "Viết cụ thể, thực dụng, phù hợp người đọc thật; tránh văn mẫu chung chung, tránh nhồi từ khóa.\n"
            . "Nếu là đồ thờ, giọng văn trang trọng và đúng ngữ cảnh thờ cúng. Nếu là quà tặng, tập trung tình huống tặng và cách chọn. Nếu là trang trí, tập trung không gian, chất men, kích thước và phối hợp.\n\n"
            . "Trả về JSON hợp lệ duy nhất, không markdown, không code fence, không giải thích ngoài JSON.\n"
            . "Schema bắt buộc:\n"
            . "{\n"
            . "  \"articles\": [\n"
            . "    {\n"
            . "      \"input_id\": \"article_1\",\n"
            . "      \"title\": \"...\",\n"
            . "      \"slug_hint\": \"...\",\n"
            . "      \"excerpt\": \"...\",\n"
            . "      \"seo_title\": \"...\",\n"
            . "      \"seo_description\": \"...\",\n"
            . "      \"seo_keywords\": [\"...\"],\n"
            . "      \"category_name\": \"...\",\n"
            . "      \"image_brief\": \"...\",\n"
            . "      \"sections\": [\n"
            . "        {\"heading\": \"...\", \"paragraphs\": [\"...\"], \"list_items\": [\"...\"]}\n"
            . "      ],\n"
            . "      \"faq\": [{\"question\": \"...\", \"answer\": \"...\"}]\n"
            . "    }\n"
            . "  ]\n"
            . "}\n\n"
            . "Dữ liệu đầu vào:\n"
            . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    }

    private function buildArticleSnapshot(array $context): array
    {
        return [
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
    }

    private function articleStyleProfile(array $context, int $index): array
    {
        $profiles = [
            [
                'angle' => 'hướng dẫn chọn theo nhu cầu sử dụng thực tế',
                'opening' => 'đi thẳng vào vấn đề người mua đang phân vân',
                'structure' => 'mở bài ngắn, tiêu chí chọn, lỗi hay gặp, gợi ý ứng dụng',
            ],
            [
                'angle' => 'giải thích ý nghĩa, bối cảnh sử dụng và cách phối hợp',
                'opening' => 'bắt đầu từ ngữ cảnh sử dụng trong gia đình hoặc không gian trưng bày',
                'structure' => 'bối cảnh, ý nghĩa, cách chọn, câu hỏi thường gặp',
            ],
            [
                'angle' => 'so sánh các lựa chọn để tránh mua nhầm',
                'opening' => 'nêu tình huống dễ chọn sai rồi đưa tiêu chí đối chiếu',
                'structure' => 'tình huống, bảng tiêu chí bằng bullet, lời khuyên theo ngân sách hoặc không gian',
            ],
            [
                'angle' => 'kinh nghiệm thực tế khi mua, đặt, dùng và bảo quản',
                'opening' => 'mở bằng một lưu ý thực tế tại cửa hàng hoặc khi bài trí',
                'structure' => 'kinh nghiệm chọn, kiểm tra chất lượng, cách dùng, bảo quản',
            ],
            [
                'angle' => 'gợi ý phối bộ và liên kết với sản phẩm/danh mục liên quan',
                'opening' => 'bắt đầu từ mong muốn hoàn thiện một bộ đồ hoặc một góc không gian',
                'structure' => 'gợi ý phối bộ, chọn kích thước, chọn men/họa tiết, liên kết nội bộ tự nhiên',
            ],
        ];

        $profile = $profiles[$index % count($profiles)];
        $profile['avoid_reused_headings'] = [
            'Giới thiệu chung',
            'Giá trị cốt lõi',
            'Phân tích chi tiết và ứng dụng',
            'Lời khuyên từ chuyên gia',
        ];

        return $profile;
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

    private function decodeBatchStructuredResponse(string $rawText, array $contexts, ?int $accountId, ?string $model): array
    {
        $candidate = $this->extractJsonCandidate($rawText);
        $decoded = null;

        if ($candidate !== null) {
            try {
                $decoded = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                $decoded = null;
            }
        }

        if (!is_array($decoded)) {
            $repairPrompt = "Chuyển nội dung sau thành JSON hợp lệ duy nhất theo schema {\"articles\":[...]}.\n"
                . "Không thêm markdown, không thêm giải thích. Giữ tiếng Việt có dấu.\n"
                . "Số bài cần có: " . count($contexts) . ".\n\n"
                . "Nội dung:\n{$rawText}";

            $repaired = $this->geminiService->generateText($repairPrompt, $accountId, $model);
            $repairedCandidate = $this->extractJsonCandidate($repaired['text']);

            if ($repairedCandidate === null) {
                throw new \RuntimeException('AI batch response is not valid JSON.');
            }

            $decoded = json_decode($repairedCandidate, true, 512, JSON_THROW_ON_ERROR);
        }

        $articles = array_is_list($decoded)
            ? $decoded
            : (is_array($decoded['articles'] ?? null) ? $decoded['articles'] : []);

        $byInputId = [];
        foreach ($articles as $article) {
            if (!is_array($article)) {
                continue;
            }

            $inputId = trim((string) ($article['input_id'] ?? ''));
            if ($inputId !== '') {
                $byInputId[$inputId] = $article;
            }
        }

        $ordered = [];
        foreach (array_keys($contexts) as $index) {
            $inputId = 'article_' . ($index + 1);
            $ordered[$index] = $byInputId[$inputId] ?? (is_array($articles[$index] ?? null) ? $articles[$index] : null);
        }

        return $ordered;
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

        $objectStart = strpos($trimmed, '{');
        $arrayStart = strpos($trimmed, '[');

        if ($objectStart === false && $arrayStart === false) {
            return null;
        }

        $start = match (true) {
            $objectStart === false => $arrayStart,
            $arrayStart === false => $objectStart,
            default => min($objectStart, $arrayStart),
        };

        $end = $start === $arrayStart && ($objectStart === false || $arrayStart < $objectStart)
            ? strrpos($trimmed, ']')
            : strrpos($trimmed, '}');

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
        $contentHtml = $this->enforceContentLength(
            $this->buildContentHtml($sections, $faq, $context),
            $context
        );

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
            'content_html' => $contentHtml,
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
        $contentHtml = $this->enforceContentLength(
            $this->buildContentHtml(
                $this->buildFallbackSections($context),
                $this->buildFallbackFaq($context),
                $context
            ),
            $context
        );

        return [
            'title' => $title,
            'slug_hint' => $title,
            'excerpt' => $excerpt,
            'meta_title' => $this->limitText($title, 80, $title),
            'meta_description' => $this->limitText($excerpt, 180, $excerpt),
            'meta_keywords' => implode(', ', $this->normalizeKeywords([], $context)),
            'category_name' => $context['suggested_category'],
            'image_brief' => $this->buildFallbackImageBrief($context),
            'content_html' => $contentHtml,
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
            $parts[] = '<h2>Câu hỏi thường gặp</h2>';

            foreach ($faq as $item) {
                $parts[] = '<h3>' . $this->escapeHtml((string) ($item['question'] ?? '')) . '</h3>';
                $parts[] = '<p>' . $this->escapeHtml((string) ($item['answer'] ?? '')) . '</p>';
            }
        }

        if ($context['internal_links'] !== []) {
            $parts[] = '<h2>Gợi ý liên quan</h2>';
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

    private function enforceContentLength(string $html, array $context): string
    {
        $html = trim($html);
        $plainLength = $this->plainTextLength($html);

        if ($plainLength < self::MIN_ARTICLE_CHARACTERS) {
            foreach ($this->buildLengthExtensionSections($context) as $section) {
                $html .= "\n" . $this->buildContentHtml([$section], [], array_merge($context, [
                    'internal_links' => [],
                    'inline_image_url' => '',
                ]));

                if ($this->plainTextLength($html) >= self::MIN_ARTICLE_CHARACTERS) {
                    break;
                }
            }
        }

        if ($this->plainTextLength($html) > self::MAX_ARTICLE_CHARACTERS) {
            $html = $this->trimHtmlToPlainTextLength($html, self::MAX_ARTICLE_CHARACTERS);
        }

        return trim($html);
    }

    private function plainTextLength(string $html): int
    {
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return mb_strlen(trim($text), 'UTF-8');
    }

    private function trimHtmlToPlainTextLength(string $html, int $maxLength): string
    {
        preg_match_all('/<(h2|h3|p|ul)\b[^>]*>.*?<\/\1>/isu', $html, $matches);
        $blocks = $matches[0] ?? [];

        if ($blocks === []) {
            return $html;
        }

        $kept = [];
        foreach ($blocks as $block) {
            $candidate = trim(implode("\n", array_merge($kept, [$block])));
            if ($this->plainTextLength($candidate) > $maxLength && $kept !== []) {
                break;
            }

            $kept[] = $block;
        }

        return trim(implode("\n", $kept));
    }

    private function buildLengthExtensionSections(array $context): array
    {
        $primaryKeyword = $context['primary_keyword'];
        $usageContext = $this->resolveUsageContext($context);
        $selectionFocus = $this->resolveSelectionFocus($context);

        return [
            [
                'heading' => "Cách chọn {$primaryKeyword} theo nhu cầu thực tế",
                'paragraphs' => [
                    "Khi tìm hiểu {$primaryKeyword}, người mua thường không chỉ cần một định nghĩa ngắn mà còn cần biết món đồ đó có hợp với không gian, ngân sách và mục đích sử dụng của mình hay không. Vì vậy, nên bắt đầu từ bối cảnh cụ thể: dùng hằng ngày, trưng bày, làm quà tặng hay đặt trong {$usageContext}. Mỗi bối cảnh sẽ dẫn tới cách ưu tiên khác nhau về kích thước, chất men, họa tiết và mức độ đồng bộ với những món đã có sẵn.",
                    "Nếu chọn cho gia đình, yếu tố bền, dễ lau chùi và hài hòa với tổng thể thường quan trọng hơn các chi tiết quá cầu kỳ. Nếu chọn để biếu tặng hoặc bài trí trang trọng, nên chú ý thêm tới câu chuyện sản phẩm, cách đóng gói, ý nghĩa hoa văn và cảm giác cân đối khi đặt cùng các vật phẩm liên quan.",
                ],
                'list_items' => [
                    "Xác định trước vị trí đặt hoặc tình huống sử dụng chính.",
                    "Đối chiếu {$selectionFocus} thay vì chỉ nhìn một ảnh sản phẩm đơn lẻ.",
                    "Ưu tiên sản phẩm có hình ảnh, thông tin kích thước và mô tả rõ ràng.",
                ],
            ],
            [
                'heading' => "Những lỗi nên tránh khi chọn {$primaryKeyword}",
                'paragraphs' => [
                    "Lỗi phổ biến nhất là chọn theo cảm tính vì thấy mẫu đẹp, nhưng khi đặt vào không gian thật lại bị lệch tông hoặc sai tỷ lệ. Với đồ gốm, cảm giác đẹp phụ thuộc nhiều vào khoảng cách nhìn, ánh sáng, màu nền và các món xung quanh. Một mẫu có họa tiết nổi bật có thể rất hợp để làm điểm nhấn, nhưng chưa chắc phù hợp nếu không gian đã nhiều chi tiết.",
                    "Một lỗi khác là tách từng keyword thành từng bài hoặc từng lựa chọn riêng biệt mà không nhìn vào ý định tìm kiếm phía sau. Những cụm gần nghĩa nên được hiểu như một nhóm nhu cầu, từ đó nội dung và sản phẩm gợi ý sẽ tự nhiên hơn, tránh trùng lặp và giúp người đọc dễ ra quyết định hơn.",
                ],
                'list_items' => [
                    "Không chọn chỉ vì tên gọi giống keyword nếu công năng không đúng.",
                    "Không bỏ qua kích thước thực tế và cách phối với món liên quan.",
                    "Không lạm dụng quá nhiều keyword khiến bài đọc thiếu tự nhiên.",
                ],
            ],
            [
                'heading' => "Gợi ý sử dụng và liên kết nội dung liên quan",
                'paragraphs' => [
                    "{$primaryKeyword} nên được đặt trong một hành trình đọc có liên kết với danh mục, sản phẩm và các bài hướng dẫn cùng chủ đề. Khi người đọc đã hiểu tiêu chí chọn, họ thường muốn xem mẫu thật, so sánh các dòng men hoặc đọc thêm về cách bài trí. Liên kết nội bộ lúc này không chỉ phục vụ SEO mà còn giúp người đọc đi tiếp một bước hợp lý.",
                    "Cách làm tốt là chỉ chèn những liên kết thật sự mở rộng giá trị cho bài viết. Nếu bài đang nói về đồ thờ, liên kết nên dẫn tới nhóm đồ thờ, cách chọn kích thước hoặc những sản phẩm có bối cảnh sử dụng gần nhau. Nếu bài nói về quà tặng, liên kết nên ưu tiên bộ quà, dòng men phù hợp hoặc bài tư vấn theo dịp tặng.",
                ],
                'list_items' => [
                    "Dùng liên kết nội bộ như một gợi ý đọc tiếp, không phải đoạn quảng cáo ép buộc.",
                    "Giữ anchor text rõ nghĩa, gần với nhu cầu đang được giải thích.",
                    "Mỗi bài chỉ nên ưu tiên vài liên kết thật sự liên quan.",
                ],
            ],
        ];
    }

    private function defaultLinkDescription(array $link): string
    {
        return match ($link['type'] ?? '') {
            'product' => 'Sản phẩm phù hợp để đối chiếu màu men, công năng và cách phối bố cục.',
            'product_category' => 'Danh mục liên quan để mở rộng lựa chọn theo cùng chủ đề.',
            'blog_category' => 'Chuyên mục bài viết liên quan để đọc thêm các nội dung cùng hướng tìm kiếm.',
            default => 'Thông tin liên quan phù hợp với chủ đề đang tìm hiểu.',
        };
    }

    private function buildFallbackTitle(array $context): string
    {
        return Str::of($context['primary_keyword'])
            ->replaceMatches('/\s+/u', ' ')
            ->trim()
            ->ucfirst()
            ->value()
            . ': cách chọn và ứng dụng phù hợp';
    }

    private function buildFallbackExcerpt(array $context): string
    {
        $intent = Str::lower(Str::ascii($context['intent_label']));

        if (str_contains($intent, 'gia') || str_contains($intent, 'mua')) {
            return "Bài viết tổng hợp cách đánh giá {$context['primary_keyword']}, những điểm cần so sánh và hướng chọn theo đúng nhu cầu thực tế.";
        }

        if (str_contains($intent, 'so sanh')) {
            return "Bài viết giúp bạn đối chiếu {$context['primary_keyword']} theo các tiêu chí quan trọng để tránh chọn nhầm và tránh trùng ý giữa các nhóm sản phẩm.";
        }

        return "Bài viết giúp bạn hiểu rõ {$context['primary_keyword']}, cách chọn đúng theo bối cảnh sử dụng và các gợi ý liên quan trong ngành gốm sứ Bát Tràng.";
    }

    private function buildFallbackImageBrief(array $context): string
    {
        return "Ảnh bìa phong cách biên tập gốm sứ Bát Tràng, nhấn vào {$context['topic_label']} và bối cảnh sử dụng phù hợp với bài viết.";
    }

    private function buildFallbackSections(array $context): array
    {
        $primaryKeyword = $context['primary_keyword'];
        $usageContext = $this->resolveUsageContext($context);
        $selectionFocus = $this->resolveSelectionFocus($context);
        $variant = (int) (crc32(Str::lower(Str::ascii($primaryKeyword))) % 3);

        if ($variant === 1) {
            return [
                [
                    'heading' => "Khi nào nên quan tâm đến {$primaryKeyword}?",
                    'paragraphs' => [
                        "{$primaryKeyword} thường xuất hiện khi người đọc đang muốn hiểu rõ một lựa chọn gốm sứ trước khi mua, bài trí hoặc so sánh với các mẫu gần giống. Điểm quan trọng là phải đặt từ khóa vào đúng bối cảnh sử dụng, vì cùng một món đồ nhưng dùng để trưng bày, làm quà hay đặt trong không gian thờ cúng sẽ có tiêu chí chọn rất khác nhau.",
                        "Thay vì chỉ mô tả chung chung, bài viết cần giúp người đọc biết nên nhìn vào chi tiết nào trước: kích thước, chất men, độ đồng bộ, màu sắc, họa tiết hay ý nghĩa sử dụng. Cách tiếp cận này giúp nội dung hữu ích hơn và tránh tình trạng nhiều bài có cùng một dàn ý nhưng chỉ thay tên sản phẩm.",
                    ],
                    'list_items' => [],
                ],
                [
                    'heading' => "Tiêu chí chọn {$primaryKeyword} cho đúng không gian",
                    'paragraphs' => [
                        "Với {$usageContext}, tiêu chí đầu tiên là sự cân đối tổng thể. Một món đồ đẹp riêng lẻ chưa chắc đã đẹp khi đặt cạnh những vật phẩm khác. Người mua nên quan sát tỷ lệ, chiều cao, màu nền và khoảng trống xung quanh để tránh cảm giác quá nặng hoặc quá rời rạc.",
                        "Tiếp theo là {$selectionFocus}. Đây là nhóm tiêu chí giúp phân biệt lựa chọn phù hợp với lựa chọn chỉ đẹp trên ảnh. Nếu có thể, nên xem ảnh thật, thông số kích thước và cách phối mẫu trong một bối cảnh gần với nơi sẽ sử dụng.",
                    ],
                    'list_items' => [
                        'Chọn kích thước theo vị trí đặt, không chỉ theo cảm giác khi xem ảnh.',
                        'Ưu tiên màu men và họa tiết hài hòa với các món đã có.',
                        'Đọc kỹ mô tả công năng để tránh mua sai mục đích.',
                    ],
                ],
                [
                    'heading' => 'Cách đọc thông tin sản phẩm và bài tư vấn',
                    'paragraphs' => [
                        "Một bài tư vấn tốt về {$primaryKeyword} nên làm rõ người đọc đang cần gì, vì sao cần lựa chọn đó và nên so sánh với nhóm sản phẩm nào. Nếu bài chỉ lặp lại các câu quen thuộc, người đọc sẽ khó nhận ra khác biệt giữa các mẫu và khó ra quyết định.",
                        "Khi đọc, nên ưu tiên những phần có ví dụ cụ thể, nhắc tới bối cảnh sử dụng và chỉ ra điểm cần kiểm tra. Nội dung như vậy vừa tốt cho trải nghiệm người dùng vừa giúp website xây dựng cụm chủ đề SEO tự nhiên hơn.",
                    ],
                    'list_items' => [
                        'Tìm các đoạn nói rõ ưu, nhược điểm theo hoàn cảnh dùng.',
                        'Ưu tiên bài có liên kết tới danh mục hoặc sản phẩm thật sự liên quan.',
                    ],
                ],
            ];
        }

        if ($variant === 2) {
            return [
                [
                    'heading' => "Hiểu đúng về {$primaryKeyword} trước khi chọn",
                    'paragraphs' => [
                        "{$primaryKeyword} không nên được xem như một từ khóa tách rời, mà là một nhu cầu tìm kiếm có liên quan tới sản phẩm, không gian và thói quen sử dụng. Khi hiểu đúng nhu cầu phía sau, nội dung bài viết sẽ tự nhiên hơn, ít bị trùng lặp và có khả năng hỗ trợ người đọc tốt hơn.",
                        "Với nhóm gốm sứ Bát Tràng, người đọc thường quan tâm đến độ bền, men gốm, họa tiết, ý nghĩa và cảm giác trang trọng khi sử dụng. Vì vậy bài viết cần kết hợp cả thông tin chọn mua lẫn gợi ý ứng dụng thực tế.",
                    ],
                    'list_items' => [],
                ],
                [
                    'heading' => 'Những điểm nên so sánh trước khi quyết định',
                    'paragraphs' => [
                        "Để tránh chọn theo cảm tính, nên đặt {$primaryKeyword} cạnh các lựa chọn gần nghĩa và so sánh theo {$selectionFocus}. Cách làm này giúp nhận ra mẫu nào phù hợp để dùng lâu dài, mẫu nào phù hợp làm điểm nhấn và mẫu nào nên dùng trong bối cảnh trang trọng hơn.",
                        "Nếu mua để tặng hoặc dùng trong không gian có yếu tố nghi lễ, cách trình bày và sự đồng bộ quan trọng không kém bản thân sản phẩm. Một món đồ hợp ngữ cảnh sẽ tạo cảm giác chỉn chu hơn so với lựa chọn quá nổi bật nhưng lệch tổng thể.",
                    ],
                    'list_items' => [
                        'So sánh chất men, màu sắc và độ sắc nét của họa tiết.',
                        'Đối chiếu kích thước với vị trí đặt thực tế.',
                        'Xem sản phẩm liên quan để hiểu cách phối bộ.',
                    ],
                ],
                [
                    'heading' => 'Gợi ý triển khai nội dung không bị trùng lặp',
                    'paragraphs' => [
                        "Khi tạo nhiều bài từ Excel, các cụm keyword gần nhau rất dễ sinh ra bài giống nhau nếu chỉ dùng một barem cố định. Với {$primaryKeyword}, nên chọn góc nhìn riêng: có bài tập trung chọn mua, có bài tập trung ứng dụng, có bài tập trung so sánh hoặc giải thích ý nghĩa.",
                        "Sự khác nhau về góc nhìn giúp mỗi bài có giá trị riêng, đồng thời giảm nguy cơ cannibalization giữa các URL. Người đọc cũng dễ nhận ra vì sao họ nên đọc bài này thay vì một bài khác có tiêu đề gần giống.",
                    ],
                    'list_items' => [
                        'Mỗi bài nên có một câu hỏi trung tâm khác nhau.',
                        'Heading cần bám theo keyword chính và intent, không dùng lại nguyên mẫu.',
                    ],
                ],
            ];
        }

        return [
            [
                'heading' => "Tổng quan về {$primaryKeyword}",
                'paragraphs' => [
                    "{$primaryKeyword} thường được tìm kiếm khi người dùng cần một hướng dẫn rõ ràng về cách chọn, cách dùng hoặc cách phân biệt trong nhóm gốm sứ Bát Tràng.",
                    "Khi xét đúng search intent, điều quan trọng không nằm ở việc liệt kê thật nhiều thông tin, mà là làm rõ món đồ phù hợp với {$usageContext} và mục đích sử dụng cụ thể.",
                ],
                'list_items' => [],
            ],
            [
                'heading' => 'Những điểm cần xem kỹ trước khi chọn',
                'paragraphs' => [
                    "Để tránh mua theo cảm tính, nên đối chiếu {$selectionFocus} cùng bố cục tổng thể, men sứ, họa tiết và mức độ đồng bộ với không gian sử dụng.",
                    "Với nhóm sản phẩm liên quan đến đồ thờ hoặc quà tặng, cần ưu tiên tính phù hợp về ngữ cảnh và cách trình bày hơn là chỉ nhìn vào hình ảnh sản phẩm đơn lẻ.",
                ],
                'list_items' => [
                    'Ưu tiên món đồ có bố cục và kích thước phù hợp với không gian đặt.',
                    'Đối chiếu men, họa tiết và tông màu với món đồ đang có sẵn.',
                    'Nếu mua để tặng hoặc trưng bày, cần tính đến mức độ đồng bộ và thông điệp muốn truyền tải.',
                ],
            ],
            [
                'heading' => 'Gợi ý ứng dụng và mở rộng lựa chọn',
                'paragraphs' => [
                    "Thay vì xem từng từ khóa riêng lẻ, nên nhìn {$primaryKeyword} như một cụm chủ đề có liên hệ đến danh mục sản phẩm, bài viết hướng dẫn và những gợi ý bổ sung gần nghĩa.",
                    "Cách tiếp cận này giúp nội dung tránh trùng lặp, giảm cannibalization và dễ tạo thành một cấu trúc SEO bền vững hơn cho website.",
                ],
                'list_items' => [
                    'Kết hợp bài hướng dẫn với danh mục và sản phẩm liên quan thay vì tách thành nhiều bài cùng ý.',
                    'Ưu tiên internal link đến những trang thật sự mở rộng giá trị cho người đọc.',
                ],
            ],
        ];
    }

    private function buildFallbackFaq(array $context): array
    {
        return [
            [
                'question' => "{$context['primary_keyword']} nên được chọn theo tiêu chí nào?",
                'answer' => 'Nên ưu tiên đúng nhu cầu, bố cục không gian, độ đồng bộ với các món liên quan và mức độ phù hợp với ngữ cảnh sử dụng trước khi quyết định.',
            ],
            [
                'question' => 'Có nên tách mỗi từ khóa thành một bài riêng không?',
                'answer' => 'Không nên tách máy móc. Những từ khóa gần nghĩa và cùng search intent nên được gom thành một bài để tránh trùng ý và tránh cannibalization.',
            ],
            [
                'question' => 'Khi nào nên chèn internal link trong bài?',
                'answer' => 'Chỉ nên chèn khi trang đích thật sự liên quan và giúp người đọc đi tiếp một bước tự nhiên trong hành trình tìm hiểu hoặc mua hàng.',
            ],
        ];
    }

    private function fallbackSectionHeading(array $context, int $index): string
    {
        return match ($index) {
            0 => "Tổng quan về {$context['primary_keyword']}",
            1 => 'Những điểm cần lưu ý',
            2 => 'Gợi ý chọn và ứng dụng',
            default => 'Nội dung liên quan',
        };
    }

    private function fallbackSectionParagraphs(array $context, string $heading, int $index): array
    {
        $fallback = $this->buildFallbackSections($context);

        return $fallback[$index]['paragraphs'] ?? [
            "{$heading} cần được trình bày theo hướng rõ search intent, tập trung vào thông tin giúp người đọc ra quyết định nhanh hơn và đúng hơn.",
        ];
    }

    private function resolveUsageContext(array $context): string
    {
        $haystack = Str::lower(Str::ascii(
            $context['primary_keyword'] . ' ' . $context['topic_label'] . ' ' . $context['suggested_category']
        ));

        return match (true) {
            str_contains($haystack, 'do tho'), str_contains($haystack, 'tho cung'), str_contains($haystack, 'bat huong') => 'không gian thờ cúng',
            str_contains($haystack, 'qua tang'), str_contains($haystack, 'in logo'), str_contains($haystack, 'doanh nghiep') => 'quà tặng doanh nghiệp hoặc quà biếu',
            default => 'không gian trưng bày, sử dụng hoặc tìm hiểu sản phẩm',
        };
    }

    private function resolveSelectionFocus(array $context): string
    {
        $haystack = Str::lower(Str::ascii($context['primary_keyword'] . ' ' . $context['topic_label']));

        return match (true) {
            str_contains($haystack, 'loc binh'), str_contains($haystack, 'binh') => 'kiểu dáng, họa tiết và tỷ lệ đặt trong không gian',
            str_contains($haystack, 'do tho'), str_contains($haystack, 'bat huong'), str_contains($haystack, 'chan nen') => 'kích thước, sự đồng bộ và tính trang nghiêm',
            str_contains($haystack, 'qua tang') => 'mục đích tặng, thông điệp và cách đồng bộ bộ quà',
            default => 'chất liệu, men sứ, họa tiết và ngữ cảnh sử dụng',
        };
    }

    private function cleanText(mixed $value): string
    {
        $normalized = html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function restoreCommonVietnameseDiacritics(string $value): string
    {
        $normalized = trim($value);
        if ($normalized === '') {
            return '';
        }

        $replacements = [
            'bat trang' => 'Bát Tràng',
            'gom su' => 'gốm sứ',
            'do tho' => 'đồ thờ',
            'tho cung' => 'thờ cúng',
            'ban tho' => 'bàn thờ',
            'bat huong' => 'bát hương',
            'lu huong' => 'lư hương',
            'chan nen' => 'chân nến',
            'den tho' => 'đèn thờ',
            'ong dia' => 'ông địa',
            'than tai' => 'thần tài',
            'an gian tho' => 'án gian thờ',
            'treo tuong' => 'treo tường',
            'chen nuoc' => 'chén nước',
            'loc binh' => 'lộc bình',
            'binh hoa' => 'bình hoa',
            'trang tri' => 'trang trí',
            'noi that' => 'nội thất',
            'phong khach' => 'phòng khách',
            'phong tho' => 'phòng thờ',
            'chung cu' => 'chung cư',
            'qua tang' => 'quà tặng',
            'qua bieu' => 'quà biếu',
            'doanh nghiep' => 'doanh nghiệp',
            'ky niem' => 'kỷ niệm',
            'phong thuy' => 'phong thủy',
            'y nghia' => 'ý nghĩa',
            'kieng ky' => 'kiêng kỵ',
            'bao quan' => 'bảo quản',
            've sinh' => 'vệ sinh',
            'su dung' => 'sử dụng',
            'ung dung' => 'ứng dụng',
            'phu hop' => 'phù hợp',
            'cach chon' => 'cách chọn',
            'huong dan' => 'hướng dẫn',
            'kinh nghiem' => 'kinh nghiệm',
            'so sanh' => 'so sánh',
            'phan biet' => 'phân biệt',
            'cao cap' => 'cao cấp',
            'gia re' => 'giá rẻ',
            'mau men' => 'màu men',
            'hoa tiet' => 'họa tiết',
            'men lam' => 'men lam',
            've vang' => 'vẽ vàng',
            'rong' => 'rồng',
            'phuong' => 'phượng',
            'sen' => 'sen',
        ];

        foreach ($replacements as $plain => $accented) {
            $normalized = preg_replace(
                '/(?<![\pL\pN])' . preg_quote($plain, '/') . '(?![\pL\pN])/iu',
                $accented,
                $normalized
            ) ?? $normalized;
        }

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
