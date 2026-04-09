<?php

namespace App\Services\AI;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteSetting;
use Illuminate\Support\Str;
use RuntimeException;

class ProductSeoAiService
{
    private const TEAM_IMAGE_SITE_SETTING = 'product_seo_team_image_url';
    private const MAX_GALLERY_IMAGES = 2;
    private const MAX_SPECIFICATIONS = 7;
    private const MIN_SPECIFICATIONS = 3;

    private array $sharedImageCountCache = [];

    public function __construct(
        private readonly GeminiService $geminiService,
    ) {
    }

    public function generate(array $payload, ?int $accountId = null, ?string $model = null): array
    {
        $context = $this->buildContext($payload, $accountId);
        $prompt = $this->buildPrompt($context, trim((string) ($payload['custom_instruction'] ?? '')));

        $result = $this->geminiService->generateText($prompt, $context['account_id'], $model);
        $structured = $this->decodeStructuredResponse($result['text'], $context['account_id'], $model);
        $normalized = $this->normalizeStructuredResponse($structured, $context);
        $normalized['model'] = $result['model'];

        return $normalized;
    }

    public function persist(Product $product, array $generated): Product
    {
        $product->forceFill([
            'description' => (string) ($generated['description'] ?? ''),
            'specifications' => json_encode($generated['specifications'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'meta_title' => (string) ($generated['meta_title'] ?? ''),
            'meta_description' => (string) ($generated['meta_description'] ?? ''),
            'meta_keywords' => (string) ($generated['meta_keywords'] ?? ''),
        ])->save();

        return $product->fresh();
    }

    private function buildContext(array $payload, ?int $accountId = null): array
    {
        $product = !empty($payload['product_id'])
            ? Product::query()
                ->with([
                    'category:id,name',
                    'categories:id,name',
                    'unit:id,name',
                    'siteDomain:id,domain',
                    'images',
                    'attributeValues.attribute:id,name,code,frontend_type',
                    'variations.images',
                    'variations.attributeValues.attribute:id,name,code,frontend_type',
                    'groupedItems:id,name,sku,type,weight,price,special_price',
                    'bundleItems:id,name,sku,type,weight,price,special_price',
                ])
                ->find((int) $payload['product_id'])
            : null;

        $resolvedAccountId = $accountId ?: $product?->account_id;
        $name = $this->cleanText($payload['name'] ?? $product?->name ?? '');
        if ($name === '') {
            throw new RuntimeException('Khong du du lieu ten san pham de tao SEO bang AI.');
        }

        $type = $this->cleanText($payload['type'] ?? $product?->type ?? 'simple');
        $categories = $this->resolveCategories($payload, $product);
        $attributes = $this->resolveAttributes($payload, $product);
        $images = $this->resolveImages($payload, $product);
        $teamImage = $this->resolveTeamImage($resolvedAccountId, $images);
        $mainImage = $this->resolveMainImage($images, $teamImage);
        $galleryImages = $this->resolveGalleryImages($images, $mainImage, $teamImage);

        return [
            'account_id' => $resolvedAccountId,
            'product_id' => $product?->id,
            'name' => $name,
            'sku' => $this->cleanText($payload['sku'] ?? $product?->sku ?? ''),
            'type' => $type !== '' ? $type : 'simple',
            'type_label' => $this->resolveProductTypeLabel($type),
            'category' => $categories[0] ?? $this->cleanText($payload['category'] ?? $product?->category?->name ?? ''),
            'categories' => $categories,
            'price' => $this->cleanText($payload['price'] ?? $product?->special_price ?? $product?->price ?? ''),
            'weight' => $this->cleanText($payload['weight'] ?? $product?->weight ?? ''),
            'unit' => $this->cleanText($payload['unit'] ?? $product?->unit?->name ?? ''),
            'attributes' => $attributes,
            'variations' => $this->resolveVariations($payload, $product),
            'related_items' => $this->resolveCompositeItems($payload, $product),
            'images' => $images,
            'main_image' => $mainImage,
            'gallery_images' => $galleryImages,
            'team_image' => $teamImage,
        ];
    }

    private function buildPrompt(array $context, string $customInstruction): string
    {
        $snapshot = [
            'name' => $context['name'],
            'sku' => $context['sku'],
            'type' => $context['type_label'],
            'category' => $context['category'],
            'categories' => $context['categories'],
            'price' => $context['price'],
            'weight' => $context['weight'],
            'unit' => $context['unit'],
            'attributes' => $context['attributes'],
            'variations' => $context['variations'],
            'related_items' => $context['related_items'],
            'has_main_image' => $context['main_image'] !== null,
            'gallery_image_count' => count($context['gallery_images']),
            'has_team_photo' => $context['team_image'] !== null,
        ];

        $instructionBlock = $customInstruction !== ''
            ? "User extra instruction (follow when it does not conflict with the rules):\n{$customInstruction}\n\n"
            : '';

        return "You are a Vietnamese SEO editor specializing in Bat Trang ceramics and worship items.\n"
            . "Write the content in Vietnamese.\n"
            . "Use only the provided product data. Do not invent material, dimensions, origin, included accessories, or spiritual meaning unless they are clearly implied by the data.\n"
            . "If some data is missing, infer carefully from the product name, category, attributes, variants, and bundle parts only.\n"
            . "Avoid repetitive machine-like wording and avoid keyword stuffing.\n"
            . "The final HTML will be built later by the system, so every field below must be plain text only.\n\n"
            . $instructionBlock
            . "Hard rules:\n"
            . "1. specifications must contain 3 to 7 items.\n"
            . "2. Each specification item must be an object with label and value, both short and natural.\n"
            . "3. intro_paragraphs should have 1 to 2 paragraphs.\n"
            . "4. highlight_items should have 3 to 5 short bullet points.\n"
            . "5. detail_paragraphs should have 2 to 4 paragraphs.\n"
            . "6. usage_items should have 2 to 4 short bullet points.\n"
            . "7. seo_title must be concise and contain the main keyword.\n"
            . "8. seo_description must be concise, attractive, and specific.\n"
            . "9. seo_keywords must contain 4 to 8 directly relevant keywords.\n"
            . "10. Return valid JSON only. No markdown, no code fences, no explanation.\n\n"
            . "JSON schema:\n"
            . "{\n"
            . "  \"specifications\": [{\"label\": \"...\", \"value\": \"...\"}],\n"
            . "  \"intro_heading\": \"...\",\n"
            . "  \"intro_paragraphs\": [\"...\"],\n"
            . "  \"highlight_heading\": \"...\",\n"
            . "  \"highlight_items\": [\"...\"],\n"
            . "  \"detail_heading\": \"...\",\n"
            . "  \"detail_paragraphs\": [\"...\"],\n"
            . "  \"usage_heading\": \"...\",\n"
            . "  \"usage_items\": [\"...\"],\n"
            . "  \"closing_paragraphs\": [\"...\"],\n"
            . "  \"seo_title\": \"...\",\n"
            . "  \"seo_description\": \"...\",\n"
            . "  \"seo_keywords\": [\"...\"]\n"
            . "}\n\n"
            . "Product data:\n"
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
            . "Keep the Vietnamese wording.\n"
            . "Do not add markdown or explanation.\n"
            . "Required top-level keys: specifications, intro_heading, intro_paragraphs, highlight_heading, highlight_items, detail_heading, detail_paragraphs, usage_heading, usage_items, closing_paragraphs, seo_title, seo_description, seo_keywords.\n\n"
            . "Content:\n{$rawText}";

        $repaired = $this->geminiService->generateText($repairPrompt, $accountId, $model);
        $repairedCandidate = $this->extractJsonCandidate($repaired['text']);

        if ($repairedCandidate === null) {
            throw new RuntimeException('AI tra ve noi dung khong dung dinh dang JSON cho goi SEO san pham.');
        }

        try {
            return json_decode($repairedCandidate, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $exception) {
            throw new RuntimeException('AI tra ve JSON khong hop le cho goi SEO san pham: ' . $exception->getMessage());
        }
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
        $specifications = $this->normalizeSpecifications($data['specifications'] ?? [], $context);
        $introParagraphs = $this->normalizeParagraphs($data['intro_paragraphs'] ?? []);
        $highlightItems = $this->normalizeShortList($data['highlight_items'] ?? [], 5);
        $detailParagraphs = $this->normalizeParagraphs($data['detail_paragraphs'] ?? []);
        $usageItems = $this->normalizeShortList($data['usage_items'] ?? [], 4);
        $closingParagraphs = $this->normalizeParagraphs($data['closing_paragraphs'] ?? [], 2);

        if ($introParagraphs === []) {
            $introParagraphs = $this->buildFallbackIntroParagraphs($context);
        }

        if ($highlightItems === []) {
            $highlightItems = collect($specifications)
                ->map(fn (array $item) => trim(($item['label'] ?? '') . ': ' . ($item['value'] ?? '')))
                ->filter()
                ->take(4)
                ->values()
                ->all();
        }

        if ($detailParagraphs === []) {
            $detailParagraphs = $this->buildFallbackDetailParagraphs($context);
        }

        if ($usageItems === []) {
            $usageItems = $this->buildFallbackUsageItems($context);
        }

        $description = $this->buildDescriptionHtml([
            'intro_heading' => $this->limitText($this->cleanText($data['intro_heading'] ?? ''), 90, 'Tong quan san pham'),
            'intro_paragraphs' => $introParagraphs,
            'highlight_heading' => $this->limitText($this->cleanText($data['highlight_heading'] ?? ''), 90, 'Diem noi bat'),
            'highlight_items' => $highlightItems,
            'detail_heading' => $this->limitText($this->cleanText($data['detail_heading'] ?? ''), 90, 'Mo ta chi tiet'),
            'detail_paragraphs' => $detailParagraphs,
            'usage_heading' => $this->limitText($this->cleanText($data['usage_heading'] ?? ''), 90, 'Ung dung va y nghia'),
            'usage_items' => $usageItems,
            'closing_paragraphs' => $closingParagraphs,
        ], $context);

        $seoTitle = $this->limitText(
            $this->cleanText($data['seo_title'] ?? ''),
            80,
            $this->buildFallbackSeoTitle($context)
        );

        $seoDescription = $this->limitText(
            $this->cleanText($data['seo_description'] ?? ''),
            180,
            $this->buildFallbackSeoDescription($context)
        );

        $keywordItems = $this->normalizeKeywords($data['seo_keywords'] ?? [], $context);

        return [
            'specifications' => $specifications,
            'description' => $description,
            'meta_title' => $seoTitle,
            'meta_description' => $seoDescription,
            'meta_keywords' => implode(', ', $keywordItems),
            'image_summary' => [
                'main_image' => $context['main_image']['image_url'] ?? null,
                'gallery_images' => collect($context['gallery_images'])->pluck('image_url')->values()->all(),
                'team_image' => $context['team_image']['image_url'] ?? null,
                'inserted_count' => count(array_filter([
                    $context['main_image']['image_url'] ?? null,
                    ...collect($context['gallery_images'])->pluck('image_url')->all(),
                    $context['team_image']['image_url'] ?? null,
                ])),
            ],
        ];
    }

    private function normalizeSpecifications(mixed $input, array $context): array
    {
        $items = collect(is_array($input) ? $input : [])
            ->map(function ($item, int $index) {
                if (is_string($item)) {
                    $raw = $this->cleanText($item);
                    if ($raw === '') {
                        return null;
                    }

                    if (preg_match('/^([^:]{2,40}):\s*(.+)$/u', $raw, $matches) === 1) {
                        return [
                            'label' => $this->limitText($this->cleanText($matches[1]), 40, 'Thong tin'),
                            'value' => $this->limitText($this->cleanText($matches[2]), 80, ''),
                        ];
                    }

                    return [
                        'label' => $this->inferSpecificationLabel($raw, $index),
                        'value' => $this->limitText($raw, 90, ''),
                    ];
                }

                if (!is_array($item)) {
                    return null;
                }

                $label = $this->limitText($this->cleanText($item['label'] ?? ''), 40, '');
                $value = $this->limitText($this->cleanText($item['value'] ?? ''), 90, '');

                if ($label === '' && $value === '') {
                    return null;
                }

                return [
                    'label' => $label !== '' ? $label : $this->inferSpecificationLabel($value, $index),
                    'value' => $value,
                ];
            })
            ->filter(fn ($item) => is_array($item) && (($item['label'] ?? '') !== '' || ($item['value'] ?? '') !== ''))
            ->take(self::MAX_SPECIFICATIONS)
            ->values();

        if ($items->count() < self::MIN_SPECIFICATIONS) {
            $fallback = collect($this->buildFallbackSpecifications($context));

            $items = $items
                ->merge($fallback)
                ->unique(fn (array $item) => Str::lower(($item['label'] ?? '') . '|' . ($item['value'] ?? '')))
                ->take(max(self::MIN_SPECIFICATIONS, min(self::MAX_SPECIFICATIONS, $items->count() + $fallback->count())))
                ->values();
        }

        return $items
            ->take(self::MAX_SPECIFICATIONS)
            ->values()
            ->all();
    }

    private function buildFallbackSpecifications(array $context): array
    {
        $items = [
            ['label' => 'Ten goi', 'value' => $context['name']],
            ['label' => 'Loai san pham', 'value' => $context['type_label']],
        ];

        if ($context['category'] !== '') {
            $items[] = ['label' => 'Danh muc', 'value' => $context['category']];
        }

        foreach ($context['attributes'] as $label => $value) {
            if ($value === '') {
                continue;
            }

            $items[] = [
                'label' => $this->limitText($this->cleanText($label), 40, 'Thuoc tinh'),
                'value' => $this->limitText($this->cleanText($value), 90, ''),
            ];
        }

        if ($context['weight'] !== '') {
            $items[] = ['label' => 'Khoi luong', 'value' => $context['weight']];
        }

        if (count($context['variations']) > 0) {
            $items[] = ['label' => 'Bien the', 'value' => count($context['variations']) . ' lua chon'];
        }

        if (count($context['related_items']) > 0) {
            $items[] = ['label' => 'Thanh phan', 'value' => count($context['related_items']) . ' mon lien quan'];
        }

        $items[] = ['label' => 'Khong gian', 'value' => $this->inferUsageSpace($context)];

        return collect($items)
            ->filter(fn (array $item) => ($item['label'] ?? '') !== '' && ($item['value'] ?? '') !== '')
            ->unique(fn (array $item) => Str::lower(($item['label'] ?? '') . '|' . ($item['value'] ?? '')))
            ->take(self::MAX_SPECIFICATIONS)
            ->values()
            ->all();
    }

    private function inferSpecificationLabel(string $value, int $index): string
    {
        $needle = Str::lower(Str::ascii($value));

        return match (true) {
            str_contains($needle, 'kich thuoc') => 'Kich thuoc',
            str_contains($needle, 'men') => 'Loai men',
            str_contains($needle, 'hoa tiet') => 'Hoa tiet',
            str_contains($needle, 'mau') => 'Mau sac',
            str_contains($needle, 'khoi luong') => 'Khoi luong',
            str_contains($needle, 'phong tho'), str_contains($needle, 'ban tho') => 'Khong gian',
            default => 'Thong tin ' . ($index + 1),
        };
    }

    private function buildDescriptionHtml(array $content, array $context): string
    {
        $parts = [];
        $usedImageUrls = [];

        $parts[] = '<h3>' . $this->escapeHtml($content['intro_heading']) . '</h3>';
        foreach ($content['intro_paragraphs'] as $paragraph) {
            $parts[] = '<p>' . $this->escapeHtml($paragraph) . '</p>';
        }

        $this->appendImageBlock($parts, $context['main_image'], $context['name'] . ' - hinh anh san pham', null, $usedImageUrls);

        $parts[] = '<h3>' . $this->escapeHtml($content['highlight_heading']) . '</h3>';
        $parts[] = '<ul>' . implode('', array_map(
            fn (string $item) => '<li>' . $this->escapeHtml($item) . '</li>',
            $content['highlight_items']
        )) . '</ul>';

        $this->appendImageBlock($parts, $context['gallery_images'][0] ?? null, $context['name'] . ' - hinh anh chi tiet', null, $usedImageUrls);

        $parts[] = '<h3>' . $this->escapeHtml($content['detail_heading']) . '</h3>';
        foreach ($content['detail_paragraphs'] as $paragraph) {
            $parts[] = '<p>' . $this->escapeHtml($paragraph) . '</p>';
        }

        $this->appendImageBlock($parts, $context['gallery_images'][1] ?? null, $context['name'] . ' - hinh anh thu vien', null, $usedImageUrls);

        $parts[] = '<h3>' . $this->escapeHtml($content['usage_heading']) . '</h3>';
        $parts[] = '<ul>' . implode('', array_map(
            fn (string $item) => '<li>' . $this->escapeHtml($item) . '</li>',
            $content['usage_items']
        )) . '</ul>';

        $this->appendImageBlock(
            $parts,
            $context['team_image'],
            'Hinh anh tap the nhan su',
            'Hinh anh tap the nhan su va khong gian trinh bay thuc te.',
            $usedImageUrls
        );

        foreach ($content['closing_paragraphs'] as $paragraph) {
            $parts[] = '<p>' . $this->escapeHtml($paragraph) . '</p>';
        }

        return implode("\n", array_filter($parts));
    }

    private function appendImageBlock(array &$parts, ?array $image, string $alt, ?string $caption, array &$usedImageUrls): void
    {
        $url = $this->normalizeRemoteUrl($image['image_url'] ?? '');
        if ($url === '' || in_array($url, $usedImageUrls, true)) {
            return;
        }

        $usedImageUrls[] = $url;
        $parts[] = '<p><img src="' . $this->escapeHtml($url) . '" alt="' . $this->escapeHtml($alt) . '" loading="lazy" /></p>';

        if ($caption !== null && trim($caption) !== '') {
            $parts[] = '<p>' . $this->escapeHtml($caption) . '</p>';
        }
    }

    private function resolveCategories(array $payload, ?Product $product): array
    {
        $items = collect([]);

        if (!empty($payload['category'])) {
            $items->push($this->cleanText($payload['category']));
        }

        foreach ((array) ($payload['categories'] ?? []) as $category) {
            $items->push($this->cleanText(is_array($category) ? ($category['name'] ?? '') : $category));
        }

        if ($product) {
            $items->push($this->cleanText($product->category?->name ?? ''));
            foreach ($product->categories as $category) {
                $items->push($this->cleanText($category->name));
            }
        }

        return $items
            ->filter()
            ->unique(fn ($value) => Str::lower((string) $value))
            ->values()
            ->all();
    }

    private function resolveAttributes(array $payload, ?Product $product): array
    {
        $attributes = [];

        foreach ((array) ($payload['attributes'] ?? []) as $key => $value) {
            $label = $this->cleanText(is_string($key) ? $key : '');
            $normalizedValue = $this->cleanText($this->stringifyValue($value));

            if ($label !== '' && $normalizedValue !== '') {
                $attributes[$label] = $normalizedValue;
            }
        }

        if ($product) {
            foreach ($product->attributeValues as $attributeValue) {
                $label = $this->cleanText($attributeValue->attribute?->name ?? '');
                $value = $this->cleanText($this->stringifyValue($attributeValue->value));

                if ($label !== '' && $value !== '' && !isset($attributes[$label])) {
                    $attributes[$label] = $value;
                }
            }
        }

        return $attributes;
    }

    private function resolveVariations(array $payload, ?Product $product): array
    {
        $items = collect([]);

        foreach ((array) ($payload['variations'] ?? []) as $variation) {
            if (!is_array($variation)) {
                continue;
            }

            $label = $this->cleanText($variation['label'] ?? $variation['name'] ?? '');
            $attributeSummary = collect((array) ($variation['attributes'] ?? []))
                ->map(fn ($value, $key) => $this->cleanText((string) $key) . ': ' . $this->cleanText($this->stringifyValue($value)))
                ->filter()
                ->values()
                ->all();

            $items->push([
                'name' => $label,
                'sku' => $this->cleanText($variation['sku'] ?? ''),
                'price' => $this->cleanText($variation['price'] ?? ''),
                'attributes' => $attributeSummary,
            ]);
        }

        if ($product) {
            foreach ($product->variations as $variation) {
                $items->push([
                    'name' => $this->cleanText($variation->name),
                    'sku' => $this->cleanText($variation->sku),
                    'price' => $this->cleanText($variation->price),
                    'attributes' => $variation->attributeValues
                        ->map(fn ($attributeValue) => $this->cleanText($attributeValue->attribute?->name ?? '') . ': ' . $this->cleanText($this->stringifyValue($attributeValue->value)))
                        ->filter()
                        ->values()
                        ->all(),
                ]);
            }
        }

        return $items
            ->filter(fn (array $item) => ($item['name'] ?? '') !== '' || ($item['sku'] ?? '') !== '')
            ->take(8)
            ->values()
            ->all();
    }

    private function resolveCompositeItems(array $payload, ?Product $product): array
    {
        $items = collect([]);

        foreach ((array) ($payload['grouped_items'] ?? []) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $items->push($this->cleanText($item['product_name'] ?? $item['name'] ?? ''));
        }

        if ($product) {
            foreach ($product->groupedItems as $item) {
                $items->push($this->cleanText($item->name));
            }
            foreach ($product->bundleItems as $item) {
                $items->push($this->cleanText($item->name));
            }
        }

        return $items
            ->filter()
            ->unique(fn ($value) => Str::lower((string) $value))
            ->take(8)
            ->values()
            ->all();
    }

    private function resolveImages(array $payload, ?Product $product): array
    {
        $items = collect([]);

        foreach ((array) ($payload['images'] ?? []) as $index => $item) {
            if (!is_array($item)) {
                continue;
            }

            $url = $this->normalizeRemoteUrl($item['large_url'] ?? $item['medium_url'] ?? $item['image_url'] ?? $item['url'] ?? '');
            if ($url === '') {
                continue;
            }

            $items->push([
                'id' => $item['id'] ?? null,
                'media_asset_id' => $item['media_asset_id'] ?? null,
                'image_url' => $url,
                'is_primary' => !empty($item['is_primary']),
                'sort_order' => (int) ($item['sort_order'] ?? $index),
                'file_name' => $this->cleanText($item['file_name'] ?? ''),
            ]);
        }

        if ($items->isEmpty() && $product) {
            foreach ($product->images as $image) {
                $url = $this->normalizeRemoteUrl($image->large_url ?: $image->image_url);
                if ($url === '') {
                    continue;
                }

                $items->push([
                    'id' => $image->id,
                    'media_asset_id' => $image->media_asset_id,
                    'image_url' => $url,
                    'is_primary' => (bool) $image->is_primary,
                    'sort_order' => (int) ($image->sort_order ?? 0),
                    'file_name' => $this->cleanText($image->file_name ?? $image->mediaAsset?->original_name ?? ''),
                ]);
            }
        }

        return $items
            ->sortBy([
                ['is_primary', 'desc'],
                ['sort_order', 'asc'],
            ])
            ->unique(fn (array $item) => Str::lower((string) ($item['image_url'] ?? '')))
            ->values()
            ->all();
    }

    private function resolveTeamImage(?int $accountId, array $images): ?array
    {
        $configuredUrl = $accountId
            ? $this->normalizeRemoteUrl((string) SiteSetting::getValue(self::TEAM_IMAGE_SITE_SETTING, $accountId, ''))
            : '';

        if ($configuredUrl === '') {
            $configuredUrl = $this->normalizeRemoteUrl((string) env('PRODUCT_SEO_TEAM_IMAGE_URL', ''));
        }

        if ($configuredUrl !== '') {
            return [
                'image_url' => $configuredUrl,
                'is_primary' => false,
                'sort_order' => 9999,
                'file_name' => 'team-photo',
            ];
        }

        if ($accountId === null || count($images) === 0) {
            return null;
        }

        $bestImage = null;
        $bestScore = 0;

        foreach ($images as $image) {
            $sharedCount = $this->countSharedImageUsage($accountId, $image);
            $hintScore = $this->scoreTeamImageHint($image);
            $score = $sharedCount + $hintScore + (!empty($image['is_primary']) ? -6 : 2);

            if ($score > $bestScore && ($sharedCount >= 3 || $hintScore >= 20)) {
                $bestScore = $score;
                $bestImage = $image;
            }
        }

        return $bestImage;
    }

    private function resolveMainImage(array $images, ?array $teamImage): ?array
    {
        $teamUrl = $teamImage['image_url'] ?? null;

        foreach ($images as $image) {
            if (($image['image_url'] ?? null) !== $teamUrl && !empty($image['is_primary'])) {
                return $image;
            }
        }

        foreach ($images as $image) {
            if (($image['image_url'] ?? null) !== $teamUrl) {
                return $image;
            }
        }

        return $images[0] ?? null;
    }

    private function resolveGalleryImages(array $images, ?array $mainImage, ?array $teamImage): array
    {
        $mainUrl = $mainImage['image_url'] ?? null;
        $teamUrl = $teamImage['image_url'] ?? null;

        return collect($images)
            ->filter(fn (array $image) => ($image['image_url'] ?? null) !== $mainUrl && ($image['image_url'] ?? null) !== $teamUrl)
            ->take(self::MAX_GALLERY_IMAGES)
            ->values()
            ->all();
    }

    private function countSharedImageUsage(int $accountId, array $image): int
    {
        $cacheKey = $image['media_asset_id']
            ? 'asset:' . (int) $image['media_asset_id']
            : 'url:' . Str::lower((string) ($image['image_url'] ?? ''));

        if (isset($this->sharedImageCountCache[$cacheKey])) {
            return $this->sharedImageCountCache[$cacheKey];
        }

        $query = ProductImage::query()
            ->whereHas('product', fn ($productQuery) => $productQuery->where('account_id', $accountId));

        if (!empty($image['media_asset_id'])) {
            $query->where('media_asset_id', (int) $image['media_asset_id']);
        } else {
            $query->where('image_url', (string) ($image['image_url'] ?? ''));
        }

        $count = (int) $query
            ->distinct('product_id')
            ->count('product_id');

        $this->sharedImageCountCache[$cacheKey] = $count;

        return $count;
    }

    private function scoreTeamImageHint(array $image): int
    {
        $haystack = Str::lower(Str::ascii(
            trim((string) ($image['file_name'] ?? ''))
            . ' '
            . trim((string) ($image['image_url'] ?? ''))
        ));

        $score = 0;
        foreach (['nhan-su', 'nhansu', 'team', 'staff', 'tap-the', 'tapthe', 'company', 'showroom', 'xuong'] as $fragment) {
            if (str_contains($haystack, $fragment)) {
                $score += 20;
            }
        }

        return $score;
    }

    private function buildFallbackIntroParagraphs(array $context): array
    {
        $category = $context['category'] !== '' ? $context['category'] : $context['type_label'];
        $intro = "{$context['name']} la mot lua chon noi bat trong nhom {$category}, phu hop cho nhu cau trung bay va su dung theo dung tinh chat tung khong gian.";
        $detail = $context['attributes'] !== []
            ? 'San pham duoc nhan dien ro hon qua cac thuoc tinh dang co, giup noi dung mo ta bam sat dac diem that te va han che suy dien qua muc can thiet.'
            : 'Noi dung duoc xay dung tu ten goi, danh muc va boi canh san pham de giu giong van tu nhien nhung van dung ban chat mat hang.';

        return [$intro, $detail];
    }

    private function buildFallbackDetailParagraphs(array $context): array
    {
        $paragraphs = [];

        if ($context['attributes'] !== []) {
            $attributeSummary = collect($context['attributes'])
                ->map(fn ($value, $label) => "{$label}: {$value}")
                ->take(4)
                ->implode(', ');

            if ($attributeSummary !== '') {
                $paragraphs[] = "Cac thong tin noi bat cua san pham hien co gom {$attributeSummary}, tu do tao nen tong the phu hop voi nhom gom su Bat Trang va do tho.";
            }
        }

        if ($context['variations'] !== []) {
            $paragraphs[] = 'San pham co them lua chon bien the lien quan, thuan tien hon khi can chon theo kich co, quy cach hoac cach phoi dung cu the.';
        }

        if ($context['related_items'] !== []) {
            $paragraphs[] = 'Voi cac thanh phan di kem hoac mon lien quan, san pham de dang ket hop thanh tong the dong bo va gon mat hon khi sap dat.';
        }

        if ($paragraphs === []) {
            $paragraphs[] = 'Noi dung mo ta uu tien su ro rang, cu the va phu hop nganh hang, giup nguoi xem nhanh hinh dung duoc tinh chat va gia tri su dung cua san pham.';
        }

        return array_slice($paragraphs, 0, 3);
    }

    private function buildFallbackUsageItems(array $context): array
    {
        $items = [
            'Phu hop de trung bay trong khong gian tho, phong khach hoac khu vuc can diem nhan trang nghiem.',
            'De ket hop voi cac mon cung tong chat lieu va tong mau de tao bo cuc dong bo hon.',
            'Nen doi chieu nhu cau su dung thuc te va kich thuoc khong gian truoc khi chon mua.',
        ];

        if ($context['team_image'] !== null) {
            $items[] = 'Hinh anh nhan su va khong gian trung bay duoc chen trong bai mo ta de tang do tin cay va tinh trinh bay.';
        }

        return array_slice($items, 0, 4);
    }

    private function buildFallbackSeoTitle(array $context): string
    {
        return $context['name'];
    }

    private function buildFallbackSeoDescription(array $context): string
    {
        $category = $context['category'] !== '' ? $context['category'] : $context['type_label'];

        return "{$context['name']} thuoc nhom {$category}, noi dung mo ta duoc toi uu gon gon, dung nganh hang va de ap dung len trang san pham.";
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

        $keywords->push($context['name']);
        if ($context['category'] !== '') {
            $keywords->push($context['category']);
        }
        if ($context['type_label'] !== '') {
            $keywords->push($context['type_label']);
        }

        foreach (array_keys($context['attributes']) as $label) {
            $keywords->push($this->cleanText($label));
        }

        if ($keywords->count() < 4) {
            $keywords->push($context['name'] . ' Bat Trang');
            if ($context['category'] !== '') {
                $keywords->push($context['category'] . ' Bat Trang');
            }
            $keywords->push($context['name'] . ' dep');
        }

        return $keywords
            ->filter()
            ->map(fn ($value) => $this->limitText((string) $value, 60, ''))
            ->unique(fn ($value) => Str::lower(Str::ascii((string) $value)))
            ->take(8)
            ->values()
            ->all();
    }

    private function normalizeParagraphs(mixed $input, int $limit = 4): array
    {
        $items = is_array($input) ? $input : preg_split('/\r\n|\r|\n/u', (string) $input);

        return collect($items ?: [])
            ->map(fn ($item) => $this->cleanText($item))
            ->filter()
            ->take($limit)
            ->values()
            ->all();
    }

    private function normalizeShortList(mixed $input, int $limit): array
    {
        $items = is_array($input) ? $input : preg_split('/\r\n|\r|\n|,|;/u', (string) $input);

        return collect($items ?: [])
            ->map(fn ($item) => $this->limitText($this->cleanText($item), 140, ''))
            ->filter()
            ->take($limit)
            ->values()
            ->all();
    }

    private function resolveProductTypeLabel(string $type): string
    {
        return match (Str::lower(trim($type))) {
            'configurable' => 'San pham bien the',
            'bundle' => 'Bo / combo',
            'grouped' => 'Nhom san pham',
            default => 'San pham don',
        };
    }

    private function inferUsageSpace(array $context): string
    {
        $haystack = Str::lower(Str::ascii($context['name'] . ' ' . implode(' ', $context['categories'])));

        return match (true) {
            str_contains($haystack, 'bat huong'), str_contains($haystack, 'lu huong') => 'Ban tho gia tien, ban tho than tai',
            str_contains($haystack, 'loc binh') => 'Phong tho, phong khach, khu trung bay',
            str_contains($haystack, 'chan nen'), str_contains($haystack, 'den tho') => 'Khong gian tho can diem nhan trang nghiem',
            str_contains($haystack, 'bo do tho'), str_contains($haystack, 'do tho') => 'Khong gian tho dong bo va chin chu',
            default => 'Khong gian trung bay phu hop voi san pham',
        };
    }

    private function normalizeRemoteUrl(mixed $value): string
    {
        $url = trim((string) $value);
        if ($url === '' || Str::startsWith($url, ['blob:', 'data:', 'javascript:'])) {
            return '';
        }

        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        return $url;
    }

    private function stringifyValue(mixed $value): string
    {
        if (is_array($value)) {
            return collect($value)
                ->map(fn ($item) => $this->cleanText($item))
                ->filter()
                ->implode(', ');
        }

        $stringValue = is_string($value) ? trim($value) : (string) $value;

        if ($stringValue !== '' && (($stringValue[0] ?? '') === '[' || ($stringValue[0] ?? '') === '{')) {
            try {
                $decoded = json_decode($stringValue, true, 512, JSON_THROW_ON_ERROR);

                if (is_array($decoded)) {
                    return $this->stringifyValue($decoded);
                }
            } catch (\Throwable) {
            }
        }

        return $stringValue;
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
