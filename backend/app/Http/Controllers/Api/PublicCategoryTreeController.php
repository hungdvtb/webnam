<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Category;
use App\Models\PublicCategoryNode;
use App\Models\SiteDomain;
use App\Support\CategoryTreeOrder;
use App\Support\StorefrontDomainScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PublicCategoryTreeController extends Controller
{
    public function show(Request $request, int $domainId)
    {
        $domain = SiteDomain::query()
            ->with('account:id,name,site_code')
            ->findOrFail($domainId);

        $accountIds = $this->accountIdsForDomain($domain);
        $this->authorizeDomainAccess($request, $domain, $accountIds);
        $sourceCategories = $this->sourceCategoriesForAccounts($accountIds);

        return response()->json([
            'domain' => [
                'id' => (int) $domain->id,
                'domain' => $domain->domain,
                'account_id' => $domain->account_id ? (int) $domain->account_id : null,
                'account_name' => $domain->account?->name,
            ],
            'accounts' => $this->accountsForDomain($accountIds),
            'source_categories' => $sourceCategories,
            'nodes' => $this->publicNodesForDomain($domain, $sourceCategories),
        ]);
    }

    public function update(Request $request, int $domainId)
    {
        $domain = SiteDomain::query()->findOrFail($domainId);
        $accountIds = $this->accountIdsForDomain($domain);
        $this->authorizeDomainAccess($request, $domain, $accountIds);

        $validated = $request->validate([
            'nodes' => ['present', 'array'],
            'nodes.*.id' => ['nullable', 'integer'],
            'nodes.*.client_id' => ['nullable', 'string', 'max:100'],
            'nodes.*.parent_id' => ['nullable'],
            'nodes.*.parent_key' => ['nullable', 'string', 'max:120'],
            'nodes.*.title' => ['required', 'string', 'max:255'],
            'nodes.*.slug' => ['nullable', 'string', 'max:255'],
            'nodes.*.status' => ['sometimes', 'boolean'],
            'nodes.*.sort_order' => ['nullable', 'integer', 'min:0'],
            'nodes.*.category_ids' => ['array'],
            'nodes.*.category_ids.*' => ['integer'],
        ]);

        $nodes = collect($validated['nodes'])
            ->values()
            ->map(function (array $node, int $index) {
                $title = trim((string) ($node['title'] ?? ''));
                if ($title === '') {
                    throw ValidationException::withMessages([
                        'nodes' => ['Tên danh mục public không được để trống.'],
                    ]);
                }

                return [
                    'id' => isset($node['id']) && is_numeric($node['id']) ? (int) $node['id'] : null,
                    'client_id' => trim((string) ($node['client_id'] ?? '')),
                    'parent_key' => trim((string) ($node['parent_key'] ?? '')),
                    'title' => $title,
                    'slug' => $this->normalizeSlug($node['slug'] ?? null, $title),
                    'status' => array_key_exists('status', $node) ? (bool) $node['status'] : true,
                    'sort_order' => isset($node['sort_order']) && is_numeric($node['sort_order'])
                        ? max(0, (int) $node['sort_order'])
                        : $index,
                    'category_ids' => collect($node['category_ids'] ?? [])
                        ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
                        ->filter(fn ($categoryId) => $categoryId > 0)
                        ->unique()
                        ->values()
                        ->all(),
                ];
            })
            ->all();

        $allowedCategoryIds = $this->allowedCategoryIds($accountIds, collect($nodes)->pluck('category_ids')->flatten()->all());
        $usedSlugs = [];

        $nodes = collect($nodes)
            ->map(function (array $node) use (&$usedSlugs, $allowedCategoryIds) {
                $baseSlug = $node['slug'] !== '' ? $node['slug'] : Str::slug($node['title']);
                $slug = $baseSlug !== '' ? $baseSlug : 'danh-muc';
                $candidate = $slug;
                $suffix = 2;

                while (isset($usedSlugs[$candidate])) {
                    $candidate = $slug . '-' . $suffix;
                    $suffix++;
                }

                $usedSlugs[$candidate] = true;
                $node['slug'] = $candidate;
                $node['category_ids'] = collect($node['category_ids'])
                    ->filter(fn ($categoryId) => isset($allowedCategoryIds[(int) $categoryId]))
                    ->values()
                    ->all();

                return $node;
            })
            ->values()
            ->all();

        DB::transaction(function () use ($domain, $nodes) {
            PublicCategoryNode::query()
                ->where('site_domain_id', $domain->id)
                ->delete();

            $createdNodes = [];
            $indexByKey = [];
            $parentKeysByIndex = [];

            foreach ($nodes as $index => $node) {
                $created = PublicCategoryNode::query()->create([
                    'site_domain_id' => $domain->id,
                    'parent_id' => null,
                    'title' => $node['title'],
                    'slug' => $node['slug'],
                    'status' => $node['status'],
                    'sort_order' => $node['sort_order'],
                    'metadata' => [],
                ]);

                $createdNodes[$index] = $created;
                foreach ($this->nodeKeys($node, $created->id) as $key) {
                    $indexByKey[$key] = $index;
                }
                $parentKeysByIndex[$index] = $node['parent_key'];

                $pivotRows = collect($node['category_ids'])
                    ->values()
                    ->map(fn ($categoryId, $sortOrder) => [
                        'public_category_node_id' => $created->id,
                        'category_id' => (int) $categoryId,
                        'sort_order' => (int) $sortOrder,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ])
                    ->all();

                if ($pivotRows !== []) {
                    DB::table('public_category_node_categories')->insert($pivotRows);
                }
            }

            foreach ($createdNodes as $index => $created) {
                $parentKey = $parentKeysByIndex[$index] ?? '';
                if ($parentKey === '' || !isset($indexByKey[$parentKey])) {
                    continue;
                }

                $parentIndex = $indexByKey[$parentKey];
                if ($parentIndex >= $index || !isset($createdNodes[$parentIndex])) {
                    continue;
                }

                $created->update(['parent_id' => $createdNodes[$parentIndex]->id]);
            }
        });

        Cache::flush();

        return response()->json([
            'message' => 'Đã lưu cây danh mục public.',
            'nodes' => $this->publicNodesForDomain($domain->fresh(), $this->sourceCategoriesForAccounts($accountIds)),
        ]);
    }

    private function authorizeDomainAccess(Request $request, SiteDomain $domain, array $accountIds): void
    {
        if ($request->user()?->is_admin) {
            return;
        }

        $requestAccountId = $request->header('X-Account-Id');
        $requestAccountId = is_numeric($requestAccountId) ? (int) $requestAccountId : null;

        if ($requestAccountId && in_array($requestAccountId, $accountIds, true)) {
            return;
        }

        if ($requestAccountId && (int) $domain->account_id === $requestAccountId) {
            return;
        }

        abort(403, 'You do not have access to this public domain.');
    }

    private function accountIdsForDomain(SiteDomain $domain): array
    {
        $ids = Account::query()
            ->where('public_domain_id', $domain->id)
            ->where('status', true)
            ->pluck('id')
            ->map(fn ($accountId) => (int) $accountId)
            ->all();

        if ($domain->account_id) {
            $ids[] = (int) $domain->account_id;
        }

        return collect($ids)
            ->filter(fn ($accountId) => $accountId > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    private function accountsForDomain(array $accountIds): array
    {
        if ($accountIds === []) {
            return [];
        }

        return Account::query()
            ->whereIn('id', $accountIds)
            ->orderBy('name')
            ->get(['id', 'name', 'site_code'])
            ->map(fn (Account $account) => [
                'id' => (int) $account->id,
                'name' => $account->name,
                'site_code' => $account->site_code,
            ])
            ->all();
    }

    private function sourceCategoriesForAccounts(array $accountIds): array
    {
        if ($accountIds === []) {
            return [];
        }

        $categories = Category::withoutGlobalScope('account_id')
            ->with(['store:id,name,slug', 'siteDomain:id,domain', 'account:id,name,site_code'])
            ->withCount('products')
            ->whereIn('account_id', $accountIds)
            ->where('status', true)
            ->publiclyListed()
            ->orderBy('account_id')
            ->orderBy('store_id')
            ->orderBy('parent_id')
            ->orderBy('order')
            ->orderBy('id')
            ->get([
                'id',
                'account_id',
                'store_id',
                'site_domain_id',
                'parent_id',
                'name',
                'slug',
                'status',
                'visibility',
                'order',
            ]);
        $categories = CategoryTreeOrder::ordered($categories, $accountIds);

        $byId = $categories->keyBy(fn (Category $category) => (int) $category->id);
        $depthFor = function (Category $category) use (&$depthFor, $byId): int {
            if (!$category->parent_id || !$byId->has((int) $category->parent_id)) {
                return 0;
            }

            return 1 + $depthFor($byId->get((int) $category->parent_id));
        };

        return $categories
            ->map(fn (Category $category) => [
                'id' => (int) $category->id,
                'account_id' => (int) $category->account_id,
                'account_name' => $category->account?->name,
                'site_code' => $category->account?->site_code,
                'store_id' => $category->store_id ? (int) $category->store_id : null,
                'store_name' => $category->store?->name,
                'site_domain_id' => $category->site_domain_id ? (int) $category->site_domain_id : null,
                'site_domain' => $category->siteDomain?->domain,
                'parent_id' => $category->parent_id ? (int) $category->parent_id : null,
                'name' => $category->name,
                'slug' => $category->slug,
                'status' => (bool) $category->status,
                'visibility' => $category->visibility,
                'order' => (int) ($category->order ?? 0),
                'depth' => $depthFor($category),
                'products_count' => (int) ($category->products_count ?? 0),
            ])
            ->values()
            ->all();
    }

    private function publicNodesForDomain(SiteDomain $domain, array $sourceCategories = []): array
    {
        $nodes = PublicCategoryNode::query()
            ->with(['categories' => function ($query) {
                $query->withoutGlobalScope('account_id')
                    ->with('account:id,name,site_code')
                    ->select('categories.id', 'categories.account_id', 'categories.name', 'categories.slug');
            }])
            ->where('site_domain_id', $domain->id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (PublicCategoryNode $node) => [
                'id' => (int) $node->id,
                'client_id' => 'node-' . $node->id,
                'parent_id' => $node->parent_id ? (int) $node->parent_id : null,
                'parent_key' => $node->parent_id ? 'id:' . $node->parent_id : '',
                'title' => $node->title,
                'slug' => $node->slug,
                'status' => (bool) $node->status,
                'sort_order' => (int) $node->sort_order,
                'category_ids' => $node->categories->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
                'source_categories' => $node->categories
                    ->map(fn (Category $category) => [
                        'id' => (int) $category->id,
                        'name' => $category->name,
                        'slug' => $category->slug,
                        'account_id' => (int) $category->account_id,
                        'account_name' => $category->account?->name,
                        'site_code' => $category->account?->site_code,
                    ])
                    ->values()
                    ->all(),
            ])
            ->values();

        return $this->appendAutomaticSourceNodes($nodes->all(), $sourceCategories);
    }

    private function appendAutomaticSourceNodes(array $nodes, array $sourceCategories): array
    {
        $mappedCategoryIds = collect($nodes)
            ->flatMap(fn (array $node) => $node['category_ids'] ?? [])
            ->map(fn ($categoryId) => (int) $categoryId)
            ->filter()
            ->unique()
            ->flip()
            ->all();
        $usedSlugs = collect($nodes)
            ->pluck('slug')
            ->filter()
            ->mapWithKeys(fn ($slug) => [(string) $slug => true])
            ->all();
        $nodeIndexByMergeKey = [];

        foreach ($nodes as $index => $node) {
            foreach ($this->mergeKeysForNode($node) as $key) {
                $nodeIndexByMergeKey[$key] = $index;
            }
        }

        foreach ($sourceCategories as $sourceCategory) {
            $categoryId = (int) ($sourceCategory['id'] ?? 0);
            if ($categoryId <= 0 || isset($mappedCategoryIds[$categoryId])) {
                continue;
            }

            $mergeKey = $this->mergeKeyForCategory($sourceCategory);
            if ($mergeKey !== '' && isset($nodeIndexByMergeKey[$mergeKey])) {
                $nodeIndex = $nodeIndexByMergeKey[$mergeKey];
                $nodes[$nodeIndex]['category_ids'][] = $categoryId;
                $nodes[$nodeIndex]['source_categories'][] = $this->sourceCategorySummary($sourceCategory);
                $nodes[$nodeIndex]['category_ids'] = collect($nodes[$nodeIndex]['category_ids'])->unique()->values()->all();
                $nodes[$nodeIndex]['source_categories'] = collect($nodes[$nodeIndex]['source_categories'])
                    ->unique(fn (array $category) => (int) ($category['id'] ?? 0))
                    ->values()
                    ->all();
                $nodes[$nodeIndex]['auto_source_category_ids'][] = $categoryId;
                $mappedCategoryIds[$categoryId] = true;
                continue;
            }

            $baseSlug = $this->normalizeSlug($sourceCategory['slug'] ?? null, (string) ($sourceCategory['name'] ?? 'Danh mục'));
            $slug = $baseSlug !== '' ? $baseSlug : 'danh-muc';
            $candidate = $slug;
            $suffix = 2;
            while (isset($usedSlugs[$candidate])) {
                $candidate = $slug . '-' . $suffix;
                $suffix++;
            }
            $usedSlugs[$candidate] = true;

            $nodes[] = [
                'id' => null,
                'client_id' => 'auto-category-' . $categoryId,
                'parent_id' => null,
                'parent_key' => '',
                'title' => (string) ($sourceCategory['name'] ?? 'Danh mục'),
                'slug' => $candidate,
                'status' => true,
                'sort_order' => count($nodes),
                'category_ids' => [$categoryId],
                'source_categories' => [$this->sourceCategorySummary($sourceCategory)],
                'auto_source_category_ids' => [$categoryId],
                'is_auto' => true,
            ];

            $nodeIndex = count($nodes) - 1;
            $mappedCategoryIds[$categoryId] = true;
            foreach ($this->mergeKeysForNode($nodes[$nodeIndex]) as $key) {
                $nodeIndexByMergeKey[$key] = $nodeIndex;
            }
        }

        $categoryIdToNodeKey = [];
        foreach ($nodes as $node) {
            $key = $node['id'] ? 'id:' . $node['id'] : (string) ($node['client_id'] ?? '');
            if ($key === '') {
                continue;
            }

            foreach ($node['category_ids'] ?? [] as $categoryId) {
                $categoryIdToNodeKey[(int) $categoryId] = $key;
            }
        }

        foreach ($nodes as $index => $node) {
            if (empty($node['is_auto']) || !empty($node['parent_key'])) {
                continue;
            }

            $firstCategoryId = (int) (($node['category_ids'][0] ?? 0));
            $sourceCategory = collect($sourceCategories)->first(fn (array $category) => (int) ($category['id'] ?? 0) === $firstCategoryId);
            $parentCategoryId = (int) ($sourceCategory['parent_id'] ?? 0);
            $parentKey = $categoryIdToNodeKey[$parentCategoryId] ?? '';

            if ($parentKey !== '' && $parentKey !== ($node['client_id'] ?? '')) {
                $nodes[$index]['parent_key'] = $parentKey;
            }
        }

        return array_values($nodes);
    }

    private function mergeKeysForNode(array $node): array
    {
        return collect([
            $this->normalizedMergeKey($node['title'] ?? ''),
            $this->normalizedMergeKey($node['slug'] ?? ''),
        ])->filter()->unique()->values()->all();
    }

    private function mergeKeyForCategory(array $category): string
    {
        return $this->normalizedMergeKey($category['name'] ?? '')
            ?: $this->normalizedMergeKey($category['slug'] ?? '');
    }

    private function normalizedMergeKey(mixed $value): string
    {
        return Str::slug((string) $value);
    }

    private function sourceCategorySummary(array $sourceCategory): array
    {
        return [
            'id' => (int) ($sourceCategory['id'] ?? 0),
            'name' => $sourceCategory['name'] ?? '',
            'slug' => $sourceCategory['slug'] ?? '',
            'account_id' => (int) ($sourceCategory['account_id'] ?? 0),
            'account_name' => $sourceCategory['account_name'] ?? null,
            'site_code' => $sourceCategory['site_code'] ?? null,
        ];
    }

    private function allowedCategoryIds(array $accountIds, array $categoryIds): array
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter(fn ($categoryId) => $categoryId > 0)
            ->unique()
            ->values()
            ->all();

        if ($normalizedCategoryIds === [] || $accountIds === []) {
            return [];
        }

        $query = Category::withoutGlobalScope('account_id')
            ->whereIn('id', $normalizedCategoryIds)
            ->where('status', true)
            ->publiclyListed();
        StorefrontDomainScope::applyAccountScope($query, null, $accountIds, 'categories.account_id');

        return $query
            ->pluck('id')
            ->mapWithKeys(fn ($id) => [(int) $id => true])
            ->all();
    }

    private function nodeKeys(array $node, int $createdId): array
    {
        return collect([
            $node['client_id'] !== '' ? $node['client_id'] : null,
            $node['id'] ? 'id:' . $node['id'] : null,
            'id:' . $createdId,
            (string) $createdId,
        ])
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function normalizeSlug(?string $slug, string $fallback): string
    {
        $candidate = Str::slug(trim((string) $slug));
        if ($candidate !== '') {
            return $candidate;
        }

        return Str::slug($fallback);
    }
}
