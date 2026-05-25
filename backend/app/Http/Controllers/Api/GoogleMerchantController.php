<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SyncGoogleMerchantProductJob;
use App\Models\Account;
use App\Models\GoogleMerchantSyncLog;
use App\Models\Product;
use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use App\Services\GoogleMerchant\GoogleMerchantSettingsService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class GoogleMerchantController extends Controller
{
    public function __construct(
        private readonly GoogleMerchantSettingsService $settingsService,
        private readonly GoogleMerchantProductSyncService $syncService,
    ) {
    }

    public function settings(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        return response()->json([
            'settings' => $this->settingsService->publicSettingsFor($accountId),
            'stats' => $this->syncStats($accountId),
        ]);
    }

    public function updateSettings(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'enabled' => 'nullable|boolean',
            'merchant_id' => 'required|string|max:64',
            'data_source_id' => 'nullable|string|max:128',
            'data_source_name' => 'nullable|string|max:255',
            'developer_email' => 'nullable|email|max:255',
            'credential_type' => 'required|string|in:service_account,oauth2,access_token',
            'service_account_json' => 'nullable|string',
            'service_account_manifest' => 'nullable|file|max:512',
            'oauth_client_id' => 'nullable|string|max:255',
            'oauth_client_secret' => 'nullable|string|max:2000',
            'oauth_refresh_token' => 'nullable|string|max:4000',
            'access_token' => 'nullable|string|max:4000',
            'content_language' => 'required|string|size:2',
            'feed_label' => 'required|string|max:20',
            'currency' => 'required|string|size:3',
            'offer_id_field' => 'required|string|in:sku,id',
            'product_url_base' => 'nullable|url|max:255',
            'default_brand' => 'nullable|string|max:120',
            'default_google_product_category' => 'nullable|string|max:750',
            'inactive_action' => 'required|string|in:out_of_stock,delete',
            'clear_credentials' => 'nullable|boolean',
        ]);

        if ($request->hasFile('service_account_manifest')) {
            $manifest = $request->file('service_account_manifest');
            $extension = Str::lower((string) $manifest->getClientOriginalExtension());

            if ($extension !== 'json') {
                return response()->json([
                    'message' => 'File manifest phải có định dạng .json.',
                ], 422);
            }

            $json = trim((string) $manifest->get());
            if ($json === '') {
                return response()->json([
                    'message' => 'File manifest.json đang rỗng.',
                ], 422);
            }

            $validated['service_account_json'] = $json;
            $validated['service_account_manifest_name'] = $manifest->getClientOriginalName() ?: 'manifest.json';
        }

        try {
            $settings = $this->settingsService->update((int) $validated['account_id'], $validated);
        } catch (\Throwable $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }

        return response()->json([
            'message' => 'Google Merchant settings saved.',
            'settings' => $settings,
            'stats' => $this->syncStats((int) $validated['account_id']),
        ]);
    }

    public function dataSources(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        try {
            return response()->json([
                'data_sources' => $this->syncService->listDataSources($accountId),
            ]);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function test(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        try {
            $result = $this->syncService->testConnection($accountId);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Google Merchant connection OK.',
            ...$result,
        ]);
    }

    public function registerGcp(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'nullable|exists:accounts,id',
            'developer_email' => 'nullable|email|max:255',
        ]);

        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json([
                'message' => 'Vui lòng chọn account trước khi đăng ký GCP project.',
            ], 422);
        }

        $developerEmail = trim((string) ($validated['developer_email'] ?? ''));
        if ($developerEmail === '') {
            $settings = $this->settingsService->settingsFor($accountId);
            $developerEmail = trim((string) ($settings['developer_email'] ?? ''));
        }

        if ($developerEmail === '') {
            return response()->json([
                'message' => 'Vui lòng nhập email Google của nhà phát triển.',
            ], 422);
        }

        try {
            $response = $this->syncService->registerGcpProject($developerEmail, $accountId);
            $settings = $this->settingsService->update($accountId, [
                'developer_email' => $developerEmail,
            ]);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Đã đăng ký GCP project với Merchant Center. Vui lòng chờ khoảng 5 phút rồi kiểm tra kết nối lại.',
            'developer_email' => $developerEmail,
            'response' => $response,
            'settings' => $settings,
        ]);
    }

    public function syncProduct(Request $request, int $id)
    {
        $product = Product::withTrashed()->findOrFail($id);
        try {
            $result = $this->syncService->syncProduct($product, $request->input('action'));
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json($result);
    }

    public function syncProducts(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'nullable|array',
            'ids.*' => 'integer|min:1',
            'all' => 'nullable|boolean',
            'queue' => 'nullable|boolean',
            'action' => 'nullable|string|in:upsert,out_of_stock,delete',
            'cursor' => 'nullable|integer|min:0',
            'batch_size' => 'nullable|integer|min:1|max:25',
        ]);

        if (!empty($validated['all'])) {
            $accountId = $this->resolveAccountId($request);
            $query = $this->googleMerchantAllProductsQuery($accountId);
            $runImmediately = array_key_exists('queue', $validated) && $validated['queue'] === false;

            if ($runImmediately) {
                $cursor = (int) ($validated['cursor'] ?? 0);
                $batchSize = min(max((int) ($validated['batch_size'] ?? 3), 1), 25);
                $totalCandidates = (clone $query)->count();
                $batchQuery = clone $query;
                if ($cursor > 0) {
                    $batchQuery->where('products.id', '>', $cursor);
                }

                $summary = $this->syncGoogleMerchantProductsNow($batchQuery, $validated['action'] ?? null, $batchSize);
                $lastProductId = (int) ($summary['last_product_id'] ?? $cursor);
                $hasMore = $lastProductId > 0
                    && (clone $query)->where('products.id', '>', $lastProductId)->exists();

                return response()->json([
                    'status' => $summary['failed'] > 0 ? 'partial_error' : 'synced',
                    ...$summary,
                    'cursor' => $cursor,
                    'next_cursor' => $hasMore ? $lastProductId : null,
                    'finished' => !$hasMore,
                    'total_candidates' => $totalCandidates,
                    'stats' => $this->syncStats($accountId),
                ]);
            }

            $count = 0;
            $query->chunkById(200, function ($products) use (&$count, $validated) {
                foreach ($products as $product) {
                    SyncGoogleMerchantProductJob::dispatch((int) $product->id, $validated['action'] ?? null)->afterResponse();
                    $count++;
                }
            });

            return response()->json([
                'status' => 'queued',
                'queued' => $count,
            ]);
        }

        $ids = collect($validated['ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json([
                'message' => 'No products selected.',
            ], 422);
        }

        if (!empty($validated['queue'])) {
            $ids->each(fn (int $id) => SyncGoogleMerchantProductJob::dispatch($id, $validated['action'] ?? null)->afterResponse());

            return response()->json([
                'status' => 'queued',
                'queued' => $ids->count(),
            ]);
        }

        $results = [];
        $failed = 0;

        Product::withTrashed()
            ->whereIn('id', $ids->all())
            ->orderBy('id')
            ->get()
            ->each(function (Product $product) use (&$results, &$failed, $validated) {
                try {
                    $results[] = $this->syncService->syncProduct($product, $validated['action'] ?? null);
                } catch (\Throwable $exception) {
                    $failed++;
                    $results[] = [
                        'status' => 'error',
                        'product_id' => (int) $product->id,
                        'message' => $exception->getMessage(),
                    ];
                }
            });

        return response()->json([
            'status' => $failed > 0 ? 'partial_error' : 'synced',
            'total' => count($results),
            'failed' => $failed,
            'results' => $results,
        ]);
    }

    private function googleMerchantAllProductsQuery(?int $accountId)
    {
        $query = Product::withTrashed()
            ->where(function ($productQuery) {
                $productQuery
                    ->where(function ($sellableProductQuery) {
                        $sellableProductQuery
                            ->whereNull('products.deleted_at')
                            ->where('status', true)
                            ->whereDoesntHave('parentConfigurable');
                    })
                    ->orWhereNotNull('google_merchant_offer_id')
                    ->orWhereNotNull('google_merchant_product_input_name')
                    ->orWhereIn('google_merchant_sync_status', ['synced', 'error']);
            })
            ->orderBy('id');

        if ($accountId) {
            $query->where(function ($accountQuery) use ($accountId) {
                $accountQuery
                    ->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            });
        }

        return $query;
    }

    private function syncGoogleMerchantProductsNow($query, ?string $action, int $limit = 0): array
    {
        $summary = [
            'total_scanned' => 0,
            'updated' => 0,
            'skipped' => 0,
            'deleted' => 0,
            'failed' => 0,
            'errors' => [],
            'last_product_id' => null,
        ];

        $products = $limit > 0
            ? $query->limit($limit)->get()
            : $query->get();

        foreach ($products as $product) {
            $summary['total_scanned']++;
            $summary['last_product_id'] = (int) $product->id;

            try {
                $result = $this->syncService->syncProduct($product, $action);
                $status = (string) ($result['status'] ?? 'synced');

                if ($status === 'deleted') {
                    $summary['deleted']++;
                } elseif ($status === 'skipped') {
                    $summary['skipped']++;
                } else {
                    $summary['updated']++;
                }

                foreach (($result['bundle_options'] ?? []) as $bundleOptionResult) {
                    $optionStatus = (string) ($bundleOptionResult['status'] ?? '');
                    $optionAction = (string) ($bundleOptionResult['action'] ?? '');
                    if ($optionStatus === 'deleted' || str_contains($optionAction, 'delete')) {
                        $summary['deleted']++;
                    }
                }

                $summary['deleted'] += count($result['variant_child_deletes'] ?? []);
            } catch (\Throwable $exception) {
                $summary['failed']++;
                if (count($summary['errors']) < 20) {
                    $summary['errors'][] = [
                        'product_id' => (int) $product->id,
                        'message' => $exception->getMessage(),
                    ];
                }
            }
        }

        return $summary;
    }

    public function logs(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        $query = GoogleMerchantSyncLog::query()->latest('id');

        if ($accountId) {
            $query->where(function ($accountQuery) use ($accountId) {
                $accountQuery
                    ->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            });
        }

        if ($request->filled('product_id')) {
            $query->where('product_id', (int) $request->input('product_id'));
        }

        return response()->json($query->paginate(min(max((int) $request->input('per_page', 20), 1), 100)));
    }

    private function syncStats(?int $accountId): array
    {
        $query = Product::query();
        if ($accountId) {
            $query->where('account_id', $accountId);
        }

        return [
            'not_synced' => (clone $query)->where(function ($statusQuery) {
                $statusQuery
                    ->whereNull('google_merchant_sync_status')
                    ->orWhere('google_merchant_sync_status', 'not_synced');
            })->count(),
            'synced' => (clone $query)->where('google_merchant_sync_status', 'synced')->count(),
            'error' => (clone $query)->where('google_merchant_sync_status', 'error')->count(),
        ];
    }

    private function resolveAccountId(Request $request): ?int
    {
        $explicitAccountId = $request->input('account_id');
        if ($explicitAccountId && $explicitAccountId !== 'all') {
            return (int) $explicitAccountId;
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all') {
            return (int) $headerAccountId;
        }

        $siteCode = $request->header('X-Site-Code');
        if ($siteCode) {
            $accountId = Account::query()->where('site_code', $siteCode)->value('id');

            return $accountId ? (int) $accountId : null;
        }

        return null;
    }
}
