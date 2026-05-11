<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (
            !Schema::hasColumn('product_links', 'bundle_option_uid')
            || !Schema::hasColumn('category_product', 'bundle_option_uid')
        ) {
            return;
        }

        $optionsByProduct = $this->loadBundleOptionsByProduct();

        DB::table('category_product')
            ->where(function ($query) {
                $query
                    ->where('item_type', 'bundle_option')
                    ->orWhereNotNull('bundle_option_post_id')
                    ->orWhereRaw("COALESCE(bundle_option_key, '') <> ''")
                    ->orWhereRaw("COALESCE(bundle_option_title, '') <> ''");
            })
            ->orderBy('id')
            ->get(['id', 'product_id', 'bundle_option_uid', 'bundle_option_key', 'bundle_option_post_id', 'bundle_option_title'])
            ->each(function ($row) use ($optionsByProduct) {
                $matchedUid = $this->matchCategoryOptionUid($row, $optionsByProduct[(int) $row->product_id] ?? []);
                if ($matchedUid === null || $matchedUid === $this->normalizeUid($row->bundle_option_uid ?? null)) {
                    return;
                }

                DB::table('category_product')
                    ->where('id', $row->id)
                    ->update([
                        'bundle_option_uid' => $matchedUid,
                        'updated_at' => now(),
                    ]);
            });
    }

    public function down(): void
    {
        // Data repair only.
    }

    private function loadBundleOptionsByProduct(): array
    {
        $optionsByProduct = [];

        DB::table('product_links')
            ->where('link_type', 'bundle')
            ->whereNotNull('bundle_option_uid')
            ->where('bundle_option_uid', '<>', '')
            ->select('product_id', 'option_post_id', 'option_title', 'bundle_option_uid')
            ->selectRaw('MIN(position) as first_position')
            ->groupBy('product_id', 'option_post_id', 'option_title', 'bundle_option_uid')
            ->orderBy('product_id')
            ->orderBy('first_position')
            ->get()
            ->each(function ($option) use (&$optionsByProduct) {
                $uid = $this->normalizeUid($option->bundle_option_uid ?? null);
                if ($uid === '') {
                    return;
                }

                $productId = (int) $option->product_id;
                $title = trim((string) ($option->option_title ?? ''));

                $optionsByProduct[$productId][] = [
                    'uid' => $uid,
                    'post_id' => filled($option->option_post_id ?? null) ? (int) $option->option_post_id : null,
                    'keys' => array_values(array_unique([
                        $this->asciiOptionKey($option->option_post_id, $title),
                        $this->localizedOptionKey($option->option_post_id, $title),
                    ])),
                    'normalized' => $this->normalizeComparableText($title),
                    'bowl_count' => $this->extractBowlCount($title),
                ];
            });

        return $optionsByProduct;
    }

    private function matchCategoryOptionUid(object $row, array $productOptions): ?string
    {
        if (empty($productOptions)) {
            return null;
        }

        $rowPostId = filled($row->bundle_option_post_id ?? null) ? (int) $row->bundle_option_post_id : null;
        $rowTitle = trim((string) ($row->bundle_option_title ?? ''));
        $rowKey = trim((string) ($row->bundle_option_key ?? ''));
        $rowKeys = array_values(array_unique(array_filter([
            $rowKey,
            $this->asciiOptionKey($rowPostId, $rowTitle),
            $this->localizedOptionKey($rowPostId, $rowTitle),
        ])));

        foreach ($productOptions as $option) {
            if ($rowPostId !== null && $option['post_id'] !== null && $rowPostId === $option['post_id']) {
                return $option['uid'];
            }

            if (!empty(array_intersect($rowKeys, $option['keys']))) {
                return $option['uid'];
            }
        }

        $rowComparable = $this->normalizeComparableText($rowTitle !== '' ? $rowTitle : $rowKey);
        if ($rowComparable === '') {
            return null;
        }

        $rowBowlCount = $this->extractBowlCount($rowTitle !== '' ? $rowTitle : $rowKey);
        $matchOptions = $rowBowlCount !== null
            ? array_values(array_filter(
                $productOptions,
                fn (array $option) => ($option['bowl_count'] ?? null) === $rowBowlCount
            ))
            : $productOptions;

        if (empty($matchOptions)) {
            $matchOptions = $productOptions;
        }

        $bestUid = null;
        $bestScore = 0.0;
        foreach ($matchOptions as $option) {
            similar_text($rowComparable, $option['normalized'], $percent);
            $score = $percent / 100;
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestUid = $option['uid'];
            }
        }

        return $bestScore >= 0.72 ? $bestUid : null;
    }

    private function asciiOptionKey($optionPostId, ?string $optionTitle): string
    {
        if (filled($optionPostId) && is_numeric($optionPostId)) {
            return 'post:' . (int) $optionPostId;
        }

        $normalized = Str::of((string) $optionTitle)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();

        return 'title:' . ($normalized !== '' ? $normalized : 'mac dinh');
    }

    private function localizedOptionKey($optionPostId, ?string $optionTitle): string
    {
        if (filled($optionPostId) && is_numeric($optionPostId)) {
            return 'post:' . (int) $optionPostId;
        }

        $normalized = Str::lower(Str::squish((string) $optionTitle));

        return 'title:' . ($normalized !== '' ? $normalized : 'mac dinh');
    }

    private function normalizeComparableText(?string $value): string
    {
        return Str::of((string) $value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();
    }

    private function extractBowlCount(?string $value): ?int
    {
        $normalized = $this->normalizeComparableText($value);

        return preg_match('/\b([0-9]+)\s*bat\b/', $normalized, $matches) === 1
            ? (int) $matches[1]
            : null;
    }

    private function normalizeUid($value): string
    {
        $uid = trim((string) $value);

        return preg_match('/^[A-Za-z0-9:_-]{1,64}$/', $uid) === 1 ? $uid : '';
    }
};
