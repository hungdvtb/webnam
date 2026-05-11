<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'bundle_option_uid')) {
                $table->string('bundle_option_uid', 64)->nullable()->after('option_post_id');
                $table->index(['product_id', 'link_type', 'bundle_option_uid'], 'product_links_bundle_option_uid_index');
            }
        });

        Schema::table('category_product', function (Blueprint $table) {
            if (!Schema::hasColumn('category_product', 'bundle_option_uid')) {
                $table->string('bundle_option_uid', 64)->nullable()->after('bundle_option_key');
                $table->index(['category_id', 'item_type', 'bundle_option_uid'], 'category_product_bundle_option_uid_index');
            }
        });

        $this->backfillProductLinkOptionUids();
        $this->backfillCategoryProductOptionUids();
    }

    public function down(): void
    {
        Schema::table('category_product', function (Blueprint $table) {
            if (Schema::hasColumn('category_product', 'bundle_option_uid')) {
                $table->dropIndex('category_product_bundle_option_uid_index');
                $table->dropColumn('bundle_option_uid');
            }
        });

        Schema::table('product_links', function (Blueprint $table) {
            if (Schema::hasColumn('product_links', 'bundle_option_uid')) {
                $table->dropIndex('product_links_bundle_option_uid_index');
                $table->dropColumn('bundle_option_uid');
            }
        });
    }

    private function backfillProductLinkOptionUids(): void
    {
        $rows = DB::table('product_links')
            ->where('link_type', 'bundle')
            ->orderBy('product_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'product_id', 'option_post_id', 'option_title', 'bundle_option_uid']);

        $uidsByGroup = [];

        foreach ($rows as $row) {
            $existingUid = $this->normalizeUid($row->bundle_option_uid ?? null);
            $groupKey = $this->bundleGroupKey($row->product_id, $row->option_post_id, $row->option_title);

            if ($existingUid !== '') {
                $uidsByGroup[$groupKey] = $existingUid;
                continue;
            }

            if (!isset($uidsByGroup[$groupKey])) {
                $uidsByGroup[$groupKey] = (string) Str::uuid();
            }

            DB::table('product_links')
                ->where('id', $row->id)
                ->update([
                    'bundle_option_uid' => $uidsByGroup[$groupKey],
                    'updated_at' => now(),
                ]);
        }
    }

    private function backfillCategoryProductOptionUids(): void
    {
        $linkOptions = DB::table('product_links')
            ->where('link_type', 'bundle')
            ->whereNotNull('bundle_option_uid')
            ->select('product_id', 'option_post_id', 'option_title', 'bundle_option_uid')
            ->selectRaw('MIN(position) as first_position')
            ->groupBy('product_id', 'option_post_id', 'option_title', 'bundle_option_uid')
            ->orderBy('product_id')
            ->orderBy('first_position')
            ->get();

        $optionsByProduct = [];
        foreach ($linkOptions as $option) {
            $productId = (int) $option->product_id;
            $title = trim((string) ($option->option_title ?? ''));
            $uid = $this->normalizeUid($option->bundle_option_uid ?? null);

            if ($uid === '') {
                continue;
            }

            $optionsByProduct[$productId][] = [
                'uid' => $uid,
                'post_id' => filled($option->option_post_id ?? null) ? (int) $option->option_post_id : null,
                'title' => $title,
                'keys' => array_values(array_unique([
                    $this->asciiOptionKey($option->option_post_id, $title),
                    $this->localizedOptionKey($option->option_post_id, $title),
                ])),
                'normalized' => $this->normalizeComparableText($title),
                'bowl_count' => $this->extractBowlCount($title),
            ];
        }

        $categoryRows = DB::table('category_product')
            ->where(function ($query) {
                $query
                    ->where('item_type', 'bundle_option')
                    ->orWhereNotNull('bundle_option_post_id')
                    ->orWhereRaw("COALESCE(bundle_option_key, '') <> ''")
                    ->orWhereRaw("COALESCE(bundle_option_title, '') <> ''");
            })
            ->where(function ($query) {
                $query
                    ->whereNull('bundle_option_uid')
                    ->orWhere('bundle_option_uid', '');
            })
            ->orderBy('category_id')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'product_id', 'bundle_option_key', 'bundle_option_post_id', 'bundle_option_title']);

        foreach ($categoryRows as $row) {
            $productOptions = $optionsByProduct[(int) $row->product_id] ?? [];
            if (empty($productOptions)) {
                continue;
            }

            $matchedUid = $this->matchCategoryOptionUid($row, $productOptions);
            if ($matchedUid === null) {
                continue;
            }

            DB::table('category_product')
                ->where('id', $row->id)
                ->update([
                    'bundle_option_uid' => $matchedUid,
                    'updated_at' => now(),
                ]);
        }
    }

    private function matchCategoryOptionUid(object $row, array $productOptions): ?string
    {
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
            $score = $this->similarityScore($rowComparable, $option['normalized']);
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestUid = $option['uid'];
            }
        }

        return $bestScore >= 0.72 ? $bestUid : null;
    }

    private function bundleGroupKey($productId, $optionPostId, ?string $optionTitle): string
    {
        if (filled($optionPostId) && is_numeric($optionPostId)) {
            return (int) $productId . ':post:' . (int) $optionPostId;
        }

        return (int) $productId . ':' . $this->localizedOptionKey(null, $optionTitle);
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

    private function similarityScore(string $left, string $right): float
    {
        if ($left === '' || $right === '') {
            return 0.0;
        }

        similar_text($left, $right, $percent);

        return $percent / 100;
    }
};
