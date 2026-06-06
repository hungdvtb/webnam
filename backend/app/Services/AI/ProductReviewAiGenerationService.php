<?php

namespace App\Services\AI;

use App\Models\Product;
use App\Models\ProductReview;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class ProductReviewAiGenerationService
{
    private const SHOP_NAME = 'Gốm Đại Thành';
    private const MAX_TOP_UP_ATTEMPTS = 4;

    public function __construct(
        private readonly GeminiService $geminiService,
    ) {
    }

    public function generateForProduct(Product $product, array $options = []): array
    {
        $replace = (bool) ($options['replace'] ?? false);
        $existingCount = ProductReview::query()
            ->where('product_id', $product->id)
            ->where('source_type', ProductReview::SOURCE_ADMIN_AI)
            ->whereNull('parent_id')
            ->count();

        if ($existingCount > 0 && ! $replace) {
            return [
                'skipped' => true,
                'reason' => 'existing_admin_ai_reviews',
                'existing_reviews' => $existingCount,
            ];
        }

        $min = max(1, (int) ($options['min'] ?? config('product_review_ai.min_reviews', 90)));
        $max = max($min, (int) ($options['max'] ?? config('product_review_ai.max_reviews', 100)));
        $targetCount = random_int($min, $max);
        $batchSize = min(25, max(5, (int) config('product_review_ai.batch_size', 20)));
        $context = $this->buildProductContext($product);

        $plans = $this->buildReviewPlans($targetCount);
        $generatedRows = [];
        $usedComments = [];
        $lastModel = null;

        foreach (array_chunk($plans, $batchSize) as $batchIndex => $planBatch) {
            $result = $this->generateBatch($context, $planBatch, $usedComments);
            $lastModel = $result['model'] ?? $lastModel;
            $generatedRows = array_merge(
                $generatedRows,
                $this->normalizeGeneratedRows($context, $planBatch, $result['reviews'], $usedComments)
            );

            if ($batchIndex < (int) ceil(count($plans) / $batchSize) - 1) {
                sleep(2);
            }
        }

        $topUpAttempts = 0;
        while (count($generatedRows) < $min && $topUpAttempts < self::MAX_TOP_UP_ATTEMPTS) {
            $needed = min($batchSize, $targetCount - count($generatedRows));
            if ($needed <= 0) {
                break;
            }

            $topUpPlans = $this->buildReviewPlans($needed, count($plans));
            $plans = array_merge($plans, $topUpPlans);
            $result = $this->generateBatch($context, $topUpPlans, $usedComments);
            $lastModel = $result['model'] ?? $lastModel;
            $generatedRows = array_merge(
                $generatedRows,
                $this->normalizeGeneratedRows($context, $topUpPlans, $result['reviews'], $usedComments)
            );
            $topUpAttempts++;
        }

        if (count($generatedRows) < $min) {
            throw new RuntimeException('AI khong tao du du lieu danh gia hop le cho san pham.');
        }

        $generatedRows = array_slice($generatedRows, 0, $targetCount);

        $stats = [
            'reviews' => 0,
            'replies' => 0,
            'deleted_existing' => 0,
            'model' => $lastModel,
        ];

        DB::transaction(function () use ($product, $replace, $generatedRows, &$stats) {
            if ($replace) {
                $existingIds = ProductReview::query()
                    ->where('product_id', $product->id)
                    ->where('source_type', ProductReview::SOURCE_ADMIN_AI)
                    ->whereNull('parent_id')
                    ->pluck('id');

                $stats['deleted_existing'] = $existingIds->count();

                if ($existingIds->isNotEmpty()) {
                    ProductReview::query()->whereIn('id', $existingIds)->delete();
                }
            }

            foreach ($generatedRows as $row) {
                $review = ProductReview::create([
                    'account_id' => $product->account_id,
                    'product_id' => $product->id,
                    'parent_id' => null,
                    'user_id' => null,
                    'author_type' => 'guest',
                    'source_type' => ProductReview::SOURCE_ADMIN_AI,
                    'customer_name' => $row['customer_name'],
                    'is_anonymous' => false,
                    'rating' => $row['rating'],
                    'comment' => $row['comment'],
                    'status' => ProductReview::STATUS_VISIBLE,
                    'is_approved' => true,
                    'created_at' => $row['created_at'],
                    'admin_seen_at' => now(),
                ]);

                $stats['reviews']++;

                if (! empty($row['reply'])) {
                    ProductReview::create([
                        'account_id' => $product->account_id,
                        'product_id' => $product->id,
                        'parent_id' => $review->id,
                        'user_id' => null,
                        'author_type' => 'admin',
                        'source_type' => ProductReview::SOURCE_ADMIN_AI,
                        'customer_name' => self::SHOP_NAME,
                        'is_anonymous' => false,
                        'rating' => 0,
                        'comment' => $row['reply'],
                        'status' => ProductReview::STATUS_VISIBLE,
                        'is_approved' => true,
                        'created_at' => $row['reply_created_at'],
                        'admin_seen_at' => now(),
                    ]);

                    $stats['replies']++;
                }
            }
        });

        return [
            'skipped' => false,
            ...$stats,
        ];
    }

    private function buildProductContext(Product $product): array
    {
        $product->loadMissing([
            'category:id,name',
            'categories:id,name',
            'unit:id,name',
            'attributeValues.attribute:id,name,code',
            'variations.attributeValues.attribute:id,name,code',
            'groupedItems:id,name,sku,type,weight,price,special_price',
            'bundleItems:id,name,sku,type,weight,price,special_price',
        ]);

        $categoryNames = collect([$product->category?->name])
            ->merge($product->relationLoaded('categories') ? $product->categories->pluck('name') : [])
            ->filter()
            ->unique()
            ->values()
            ->all();

        $attributes = $product->attributeValues
            ->map(fn ($value) => [
                'label' => $value->attribute?->name ?: $value->attribute?->code,
                'value' => $this->cleanText($value->value),
            ])
            ->filter(fn ($item) => filled($item['label']) && filled($item['value']))
            ->take(10)
            ->values()
            ->all();

        $compositeItems = collect()
            ->merge($product->relationLoaded('groupedItems') ? $product->groupedItems : [])
            ->merge($product->relationLoaded('bundleItems') ? $product->bundleItems : [])
            ->map(fn (Product $item) => [
                'name' => $this->cleanText($item->name),
                'type' => $this->cleanText($item->type),
            ])
            ->filter(fn ($item) => filled($item['name']))
            ->take(12)
            ->values()
            ->all();

        return [
            'account_id' => $product->account_id ? (int) $product->account_id : null,
            'product_id' => (int) $product->id,
            'name' => $this->cleanText($product->name),
            'type' => $this->cleanText($product->type ?: 'simple'),
            'type_label' => $this->typeLabel($product->type),
            'category' => $categoryNames[0] ?? '',
            'categories' => $categoryNames,
            'generic_terms' => $this->genericTerms($product->name, $categoryNames),
            'price' => $product->special_price ?: $product->price,
            'weight' => $this->cleanText($product->weight),
            'unit' => $this->cleanText($product->unit?->name),
            'attributes' => $attributes,
            'composite_items' => $compositeItems,
        ];
    }

    private function buildReviewPlans(int $count, int $offset = 0): array
    {
        $ratings = $this->ratingsForTargetAverage($count);
        $nameProfiles = $this->profileList($count, [
            'full' => 0.38,
            'short' => 0.2,
            'facebook' => 0.15,
            'plain' => 0.1,
            'abbreviated' => 0.05,
            'compact' => 0.05,
            'nickname' => 0.07,
        ]);
        $lengthProfiles = $this->profileList($count, [
            'short' => 0.22,
            'medium' => 0.53,
            'long' => 0.25,
        ]);
        $replyIndexes = array_fill_keys($this->replyIndexes($count), true);
        $usedNames = [];
        $plans = [];

        for ($index = 0; $index < $count; $index++) {
            $globalIndex = $offset + $index;
            $nameProfile = $nameProfiles[$index] ?? 'full';

            $plans[] = [
                'item_index' => $globalIndex,
                'rating' => $ratings[$index] ?? 5.0,
                'customer_name' => $this->customerName($globalIndex, $nameProfile, $usedNames),
                'name_style' => $nameProfile,
                'length' => $lengthProfiles[$index] ?? 'medium',
                'reply_required' => isset($replyIndexes[$index]),
            ];
        }

        return $plans;
    }

    private function generateBatch(array $context, array $plans, array $usedComments): array
    {
        $model = trim((string) config('product_review_ai.model', '')) ?: null;
        $prompt = $this->buildPrompt($context, $plans, $usedComments);
        $result = $this->geminiService->generateText($prompt, $context['account_id'], $model);
        $decoded = $this->decodeStructuredResponse($result['text'], $context['account_id'], $model);
        $reviews = is_array($decoded['reviews'] ?? null) ? $decoded['reviews'] : $decoded;

        if (! is_array($reviews)) {
            throw new RuntimeException('AI review response khong co mang reviews hop le.');
        }

        return [
            'reviews' => $reviews,
            'model' => $result['model'] ?? $model,
        ];
    }

    private function buildPrompt(array $context, array $plans, array $usedComments): string
    {
        $snapshot = [
            'full_product_name_for_context_do_not_copy' => $context['name'],
            'type' => $context['type_label'],
            'category' => $context['category'],
            'categories' => $context['categories'],
            'generic_terms_allowed' => $context['generic_terms'],
            'price' => $context['price'],
            'weight' => $context['weight'],
            'unit' => $context['unit'],
            'attributes' => $context['attributes'],
            'bundle_or_group_items' => $context['composite_items'],
        ];

        $recentComments = array_slice(array_values($usedComments), -12);

        return "You write Vietnamese customer reviews for a ceramics / worship-item shop.\n"
            . "Return valid JSON only. Do not use markdown or explanations.\n"
            . "Every review must sound like a real Vietnamese buyer, not advertising and not SEO copy.\n"
            . "Hard rules:\n"
            . "1. Never write the full product name in any comment. Use natural words like hang, san pham, mau nay, bo nay, cai nay, or one of generic_terms_allowed.\n"
            . "2. Do not invent exact dimensions, material, included item count, origin, warranty, spiritual claims, or promises unless directly present in product_data.\n"
            . "3. Keep most comments positive but natural. Some may mention minor issues like giao hoi lau, mau ngoai doi khac anh mot ti, boc hoi lau.\n"
            . "4. Use mixed casual Vietnamese styles: some lower-case first letters, short words like ok, oke, ko, k, dc, mk, ung, on ap. Use these lightly, not every review.\n"
            . "5. No phone numbers, emails, order codes, competitor names, marketplace names, or emojis.\n"
            . "6. Do not change customer_name. Use it only as context for voice.\n"
            . "7. If reply_required is true, write a short shop reply. If false, reply must be empty string.\n"
            . "8. Replies are from the shop, polite and short, not salesy.\n\n"
            . "JSON schema:\n"
            . "{\"reviews\":[{\"item_index\":0,\"comment\":\"...\",\"reply\":\"...\"}]}\n\n"
            . "Product data:\n"
            . json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
            . "\n\nReview plan:\n"
            . json_encode(array_values($plans), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
            . "\n\nAvoid wording too similar to these recent comments:\n"
            . json_encode($recentComments, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    }

    private function normalizeGeneratedRows(array $context, array $plans, array $reviews, array &$usedComments): array
    {
        $byIndex = [];
        foreach ($reviews as $position => $row) {
            if (! is_array($row)) {
                continue;
            }

            $itemIndex = isset($row['item_index']) ? (int) $row['item_index'] : ($plans[$position]['item_index'] ?? null);
            if ($itemIndex !== null) {
                $byIndex[$itemIndex] = $row;
            }
        }

        $rows = [];
        foreach ($plans as $plan) {
            $rawRow = $byIndex[(int) $plan['item_index']] ?? null;
            if (! is_array($rawRow)) {
                continue;
            }

            $comment = $this->cleanGeneratedText((string) ($rawRow['comment'] ?? ''));
            if (! $this->validComment($comment, $context, $usedComments)) {
                continue;
            }

            $commentKey = $this->commentKey($comment);
            $usedComments[$commentKey] = $comment;

            $createdAt = $this->randomReviewDate();
            $reply = '';
            $replyCreatedAt = null;

            if (! empty($plan['reply_required'])) {
                $reply = $this->cleanGeneratedText((string) ($rawRow['reply'] ?? $rawRow['admin_reply'] ?? ''));
                if (! $this->validReply($reply, $context)) {
                    $reply = $this->fallbackReply((int) $plan['item_index']);
                }
                $replyCreatedAt = $this->replyDate($createdAt);
            }

            $rows[] = [
                'customer_name' => $plan['customer_name'],
                'rating' => (float) $plan['rating'],
                'comment' => $comment,
                'reply' => $reply,
                'created_at' => $createdAt,
                'reply_created_at' => $replyCreatedAt,
            ];
        }

        return $rows;
    }

    private function validComment(string $comment, array $context, array $usedComments): bool
    {
        $length = mb_strlen($comment);
        if ($length < 6 || $length > 800) {
            return false;
        }

        if ($this->containsContactInfo($comment) || $this->containsFullProductName($comment, $context['name'])) {
            return false;
        }

        $key = $this->commentKey($comment);
        if (isset($usedComments[$key])) {
            return false;
        }

        foreach (array_keys($usedComments) as $usedKey) {
            similar_text($key, $usedKey, $percent);
            if ($percent >= 86) {
                return false;
            }
        }

        return true;
    }

    private function validReply(string $reply, array $context): bool
    {
        $length = mb_strlen($reply);

        return $length >= 4
            && $length <= 300
            && ! $this->containsContactInfo($reply)
            && ! $this->containsFullProductName($reply, $context['name']);
    }

    private function ratingsForTargetAverage(int $count): array
    {
        $fourStars = random_int(
            max(1, (int) floor($count * 0.08)),
            max(1, (int) floor($count * 0.18))
        );

        $ratings = array_merge(
            array_fill(0, max(1, $count - $fourStars), 5.0),
            array_fill(0, $fourStars, 4.0),
        );

        shuffle($ratings);

        return array_slice($ratings, 0, $count);
    }

    private function profileList(int $count, array $weights): array
    {
        $profiles = [];
        $remaining = $count;
        $lastKey = array_key_last($weights);

        foreach ($weights as $profile => $weight) {
            $size = $profile === $lastKey ? $remaining : (int) round($count * $weight);
            $size = max(0, min($remaining, $size));
            $profiles = array_merge($profiles, array_fill(0, $size, $profile));
            $remaining -= $size;
        }

        while (count($profiles) < $count) {
            $profiles[] = $lastKey;
        }

        shuffle($profiles);

        return array_slice($profiles, 0, $count);
    }

    private function replyIndexes(int $count): array
    {
        $indexes = range(0, max(0, $count - 1));
        shuffle($indexes);

        $min = max(3, (int) ceil($count * 0.25));
        $max = max($min, (int) ceil($count * 0.45));

        return array_slice($indexes, 0, random_int($min, $max));
    }

    private function customerName(int $index, string $profile, array &$usedNames): string
    {
        for ($attempt = 0; $attempt < 100; $attempt++) {
            $seed = (int) sprintf('%u', crc32("review-name:{$profile}:{$index}:{$attempt}:" . random_int(1, 999999)));
            $name = $this->nameForProfile($profile, $seed);
            $key = $this->nameKey($name);

            if (! isset($usedNames[$key])) {
                $usedNames[$key] = true;
                return $name;
            }
        }

        $fallback = 'khach ' . ($index + 1);
        $usedNames[$this->nameKey($fallback)] = true;

        return $fallback;
    }

    private function nameForProfile(string $profile, int $seed): string
    {
        $lastNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Đinh', 'Trịnh', 'Phan', 'Võ', 'Huỳnh', 'Mai', 'Cao', 'Lâm'];
        $middleNames = ['Văn', 'Thị', 'Minh', 'Quốc', 'Thanh', 'Anh', 'Bảo', 'Ngọc', 'Gia', 'Thu', 'Hoài', 'Khánh', 'Đức', 'Hồng', 'Phương'];
        $givenNames = ['Hùng', 'Mai', 'Linh', 'Bảo', 'Trang', 'Hương', 'Nam', 'Hà', 'Đức', 'Lan', 'Duy', 'Khoa', 'Huy', 'Phúc', 'Vy', 'Châu', 'Trúc', 'Ngọc', 'Tâm', 'Tuấn', 'Bình', 'Nhung', 'My', 'Loan', 'Vân', 'Sơn', 'Đạt', 'Mạnh', 'Dung', 'Hạnh', 'Khải', 'Long', 'Toàn', 'Uyên', 'Kiệt', 'Chi'];
        $facebookNames = ['Ngọc Anh', 'Bảo Châu', 'Thanh Trúc', 'Bích Ngọc', 'Anh Thư', 'Quốc Bảo', 'Thanh Tùng', 'Thu Trang', 'Minh Đức', 'Khánh Linh', 'Gia Hân', 'Thảo My', 'Hải Yến', 'Hoàng Nam', 'Bảo An', 'Phương Nhi', 'Minh Châu', 'Tuấn Anh', 'Ngọc Hân', 'Trúc Ly', 'Hồng Nhung', 'Mai Anh', 'Diệu Linh', 'Hà My', 'Đức Anh'];
        $abbreviated = ['T. Hùng', 'A. Thảo', 'N.Anh', 'M.Hải', 'Q. Bảo', 'H. Mai', 'L. Trang', 'V. Linh', 'D. Mạnh', 'B. Ngọc', 'K. Vy', 'P. Đức', 'T.Anh', 'N. Hân', 'M. Châu', 'H.Dũng', 'A. Khoa', 'T. Trúc', 'B.Châu', 'L. Huy'];
        $compact = ['ngocanh', 'thutrang', 'minhduc', 'baochau', 'thanhtung', 'anhthu', 'quocbao', 'khanhlinh', 'thaomy', 'haiyen', 'hoangnam', 'baoan', 'phuongnhi', 'minhchau', 'tuananh', 'ngochan', 'trucly', 'hongnhung', 'maianh', 'Anh.Nguyen', 'Minh_Tran', 'Bao090', 'Hoa88', 'Linh97', 'NgocAnh95', 'Duc.Minh', 'Trang_Thu', 'Nam1990', 'Vy98'];
        $nicknames = ['chị ba', 'anh hai', 'mẹ bống', 'ba cu tí', 'cô út', 'chú sáu', 'mẹ su', 'bố gạo', 'mẹ chip', 'anh tư', 'chị hai', 'cô năm', 'mẹ bon', 'ba sóc', 'dì út', 'chú tư', 'mẹ mít', 'ba ken', 'chị cả', 'anh ba'];

        $fullName = $this->pick($lastNames, $seed) . ' '
            . $this->pick($middleNames, intdiv($seed, 3) + 17) . ' '
            . $this->pick($givenNames, intdiv($seed, 7) + 29);

        $name = match ($profile) {
            'short' => $this->pick($givenNames, $seed),
            'facebook' => $this->pick($facebookNames, $seed),
            'plain' => Str::lower(Str::ascii($seed % 3 === 0 ? $fullName : $this->pick($facebookNames, $seed))),
            'abbreviated' => $this->pick($abbreviated, $seed),
            'compact' => $this->pick($compact, $seed),
            'nickname' => $this->pick($nicknames, $seed),
            default => $fullName,
        };

        return $this->naturalNameVariant($name, $profile, $seed);
    }

    private function naturalNameVariant(string $name, string $profile, int $seed): string
    {
        if (in_array($profile, ['abbreviated', 'compact'], true)) {
            return $name;
        }

        if ($profile === 'nickname') {
            return $seed % 4 === 0 ? mb_convert_case($name, MB_CASE_TITLE, 'UTF-8') : $name;
        }

        if ($profile === 'plain') {
            return $seed % 5 === 0 ? mb_convert_case($name, MB_CASE_TITLE, 'UTF-8') : $name;
        }

        if ($seed % 13 === 0) {
            return preg_replace('/\s+/u', '  ', $name, 1) ?: $name;
        }

        if ($seed % 11 === 0 && $profile !== 'full') {
            return mb_strtolower($name, 'UTF-8');
        }

        return $name;
    }

    private function randomReviewDate(): Carbon
    {
        return now()
            ->subDays(random_int(3, 540))
            ->subHours(random_int(0, 23))
            ->subMinutes(random_int(0, 59));
    }

    private function replyDate(Carbon $reviewDate): Carbon
    {
        $replyDate = $reviewDate->copy()->addMinutes(random_int(45, 7200));

        return $replyDate->greaterThan(now()->subHours(2))
            ? now()->subHours(random_int(2, 36))
            : $replyDate;
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

        $repairPrompt = "Convert the following content into valid JSON only. Required top-level key: reviews. Keep Vietnamese text unchanged. No markdown.\n\n{$rawText}";
        $repaired = $this->geminiService->generateText($repairPrompt, $accountId, $model);
        $repairedCandidate = $this->extractJsonCandidate($repaired['text']);

        if ($repairedCandidate === null) {
            throw new RuntimeException('AI khong tra ve JSON hop le cho danh gia san pham.');
        }

        try {
            return json_decode($repairedCandidate, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $exception) {
            throw new RuntimeException('AI review JSON khong hop le: ' . $exception->getMessage());
        }
    }

    private function extractJsonCandidate(string $rawText): ?string
    {
        $text = trim($rawText);
        $text = preg_replace('/^```(?:json)?\s*/i', '', $text) ?? $text;
        $text = preg_replace('/\s*```$/', '', $text) ?? $text;
        $text = trim($text);

        if ($text === '') {
            return null;
        }

        if ((str_starts_with($text, '{') && str_ends_with($text, '}'))
            || (str_starts_with($text, '[') && str_ends_with($text, ']'))) {
            return $text;
        }

        $objectStart = strpos($text, '{');
        $objectEnd = strrpos($text, '}');
        if ($objectStart !== false && $objectEnd !== false && $objectEnd > $objectStart) {
            return substr($text, $objectStart, $objectEnd - $objectStart + 1);
        }

        $arrayStart = strpos($text, '[');
        $arrayEnd = strrpos($text, ']');
        if ($arrayStart !== false && $arrayEnd !== false && $arrayEnd > $arrayStart) {
            return substr($text, $arrayStart, $arrayEnd - $arrayStart + 1);
        }

        return null;
    }

    private function cleanGeneratedText(string $value): string
    {
        $value = strip_tags($value);
        $value = preg_replace('/[\r\n\t]+/u', ' ', $value) ?? $value;
        $value = preg_replace('/\s{2,}/u', ' ', $value) ?? $value;

        return trim($value);
    }

    private function cleanText(mixed $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', (string) $value) ?: '');
    }

    private function containsContactInfo(string $value): bool
    {
        return preg_match('/(?<!\d)(\+?84|0)\d{8,10}(?!\d)/', $value) === 1
            || preg_match('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $value) === 1;
    }

    private function containsFullProductName(string $value, string $productName): bool
    {
        $needle = $this->searchKey($productName);
        if (mb_strlen($needle) < 12) {
            return false;
        }

        return str_contains($this->searchKey($value), $needle);
    }

    private function searchKey(string $value): string
    {
        $value = Str::lower(Str::ascii($value));
        $value = preg_replace('/[^a-z0-9]+/u', ' ', $value) ?? $value;

        return trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
    }

    private function commentKey(string $value): string
    {
        return $this->searchKey($value);
    }

    private function nameKey(string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $value) ?: $value), 'UTF-8');
    }

    private function genericTerms(string $productName, array $categories): array
    {
        $haystack = $this->searchKey($productName . ' ' . implode(' ', $categories));
        $terms = ['hàng', 'sản phẩm', 'mẫu này', 'cái này'];

        foreach ([
            'bat huong' => 'bát hương',
            'mam bong' => 'mâm bồng',
            'lo hoa' => 'lọ hoa',
            'choe' => 'chóe',
            'do tho' => 'bộ đồ thờ',
            'am chen' => 'ấm chén',
            'bo chen' => 'bộ chén',
            'dia' => 'đĩa',
            'bat dia' => 'bát đĩa',
            'tuong' => 'tượng',
            'tranh' => 'tranh',
            'luc binh' => 'lục bình',
            'binh hut loc' => 'bình',
            'loc binh' => 'lọ',
        ] as $keyword => $term) {
            if (str_contains($haystack, $keyword)) {
                $terms[] = $term;
            }
        }

        return array_values(array_unique($terms));
    }

    private function typeLabel(?string $type): string
    {
        return match ($type) {
            'configurable' => 'sản phẩm có biến thể',
            'grouped' => 'nhóm sản phẩm',
            'bundle' => 'combo/bộ sản phẩm',
            'virtual' => 'sản phẩm dịch vụ',
            'downloadable' => 'sản phẩm tải xuống',
            default => 'sản phẩm đơn',
        };
    }

    private function fallbackReply(int $seed): string
    {
        $replies = [
            'Dạ shop cảm ơn anh/chị đã ủng hộ ạ.',
            'Cảm ơn anh/chị đã phản hồi, shop rất vui khi mình hài lòng.',
            'Dạ shop cảm ơn nhiều ạ.',
            'Shop cảm ơn anh/chị đã tin tưởng.',
            'Cảm ơn anh/chị, shop sẽ tiếp tục đóng gói thật cẩn thận ạ.',
            'Dạ shop ghi nhận phản hồi của anh/chị ạ.',
        ];

        return $this->pick($replies, $seed);
    }

    private function pick(array $items, int $seed): string
    {
        return $items[$seed % count($items)];
    }
}
