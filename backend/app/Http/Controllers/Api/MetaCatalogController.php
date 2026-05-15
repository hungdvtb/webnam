<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\MetaCatalogSyncLog;
use App\Services\MetaCatalog\MetaCatalogProductSyncException;
use App\Services\MetaCatalog\MetaCatalogProductSyncService;
use App\Services\MetaCatalog\MetaCatalogSettingsService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

class MetaCatalogController extends Controller
{
    public function __construct(
        private readonly MetaCatalogSettingsService $settingsService,
        private readonly MetaCatalogProductSyncService $syncService,
    ) {
    }

    public function settings(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        return response()->json([
            'settings' => $this->settingsService->publicSettingsFor($accountId),
            'latest_logs' => $this->latestLogs($accountId),
        ]);
    }

    public function updateSettings(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'nullable',
            'enabled' => 'nullable|boolean',
            'app_id' => 'nullable|string|max:64',
            'catalog_id' => 'required|string|max:64',
            'access_token' => 'nullable|string|max:12000',
            'graph_api_version' => 'nullable|string|max:16',
            'brand' => 'nullable|string|max:120',
            'currency' => 'nullable|string|size:3',
            'fallback_image_url' => 'nullable|url|max:2048',
            'delete_stale' => 'nullable|boolean',
            'sync_frequency' => 'nullable|string|in:hourly,six_hours,daily',
            'clear_access_token' => 'nullable|boolean',
        ]);

        $accountId = $this->resolveAccountId($request);

        try {
            $settings = $this->settingsService->update($accountId, $validated);
        } catch (Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Meta Catalog settings saved.',
            'settings' => $settings,
            'latest_logs' => $this->latestLogs($accountId),
        ]);
    }

    public function dryRun(Request $request)
    {
        $validated = $request->validate([
            'check_remote_urls' => 'nullable|boolean',
        ]);

        $accountId = $this->resolveAccountId($request);
        $settings = $this->settingsService->settingsFor($accountId);
        $this->settingsService->applyToConfig($settings);

        $startedAt = now();
        $startTime = microtime(true);

        try {
            $result = $this->syncService->sync([
                'dry_run' => true,
                'delete_stale' => (bool) ($settings['delete_stale'] ?? true),
                'check_remote_urls' => (bool) ($validated['check_remote_urls'] ?? false),
            ]);
            $status = ((int) ($result['batch_error_count'] ?? $result['invalid_count'] ?? 0)) > 0 ? 'error' : 'success';
            $log = $this->recordLog($request, $accountId, 'dry_run', $status, $result, $startedAt, $startTime);

            return response()->json([
                'result' => $result,
                'log' => $this->logPayload($log),
                'settings' => $this->settingsService->publicSettingsFor($accountId),
            ], $status === 'success' ? 200 : 422);
        } catch (Throwable $exception) {
            $log = $this->recordFailure($request, $accountId, 'dry_run', $exception, $startedAt, $startTime);

            return response()->json([
                'message' => $exception->getMessage(),
                'log' => $this->logPayload($log),
            ], 422);
        }
    }

    public function syncNow(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        $settings = $this->settingsService->settingsFor($accountId);
        $this->settingsService->applyToConfig($settings);

        $startedAt = now();
        $startTime = microtime(true);

        try {
            $result = $this->syncService->sync([
                'dry_run' => false,
                'delete_stale' => (bool) ($settings['delete_stale'] ?? true),
            ]);
            $status = ((int) ($result['batch_error_count'] ?? $result['invalid_count'] ?? 0)) > 0 ? 'error' : 'success';
            $log = $this->recordLog($request, $accountId, 'sync_live', $status, $result, $startedAt, $startTime);

            return response()->json([
                'result' => $result,
                'log' => $this->logPayload($log),
                'settings' => $this->settingsService->publicSettingsFor($accountId),
            ], $status === 'success' ? 200 : 422);
        } catch (Throwable $exception) {
            $log = $this->recordFailure($request, $accountId, 'sync_live', $exception, $startedAt, $startTime);

            return response()->json([
                'message' => $exception->getMessage(),
                'log' => $this->logPayload($log),
                'settings' => $this->settingsService->publicSettingsFor($accountId),
            ], 422);
        }
    }

    public function checkFeed(Request $request, string $format)
    {
        $format = Str::lower($format);
        if (!in_array($format, ['csv', 'xml'], true)) {
            return response()->json(['message' => 'Unsupported feed format.'], 422);
        }

        $accountId = $this->resolveAccountId($request);
        $links = $this->settingsService->feedLinks();
        $url = $links[$format] ?? null;
        $startedAt = now();
        $startTime = microtime(true);

        try {
            $response = Http::timeout(20)
                ->connectTimeout(8)
                ->withOptions(['verify' => (bool) config('meta_catalog.verify_ssl', true)])
                ->get($url);

            $body = (string) $response->body();
            $errors = [];
            if (!$response->successful()) {
                $errors[] = 'Feed HTTP status ' . $response->status();
            }

            if ($format === 'csv') {
                foreach (['id', 'title', 'price', 'link', 'image_link', 'product_type', 'custom_label_0'] as $field) {
                    if (!Str::contains(Str::lower(substr($body, 0, 1000)), $field)) {
                        $errors[] = "CSV missing {$field}";
                    }
                }
            } elseif (!Str::contains($body, '<rss') || !Str::contains($body, '<g:id>')) {
                $errors[] = 'XML feed does not look like a Meta product feed';
            }

            $result = [
                'feed_url' => $url,
                'format' => $format,
                'http_status' => $response->status(),
                'content_type' => $response->header('Content-Type'),
                'bytes' => strlen($body),
                'errors' => $errors,
            ];

            $log = $this->recordLog($request, $accountId, 'feed_check', empty($errors) ? 'success' : 'error', [
                'feed_count' => 0,
                'valid_count' => empty($errors) ? 1 : 0,
                'invalid_count' => count($errors),
                'request_count' => empty($errors) ? 1 : 0,
                'invalid_entries' => empty($errors) ? [] : [[
                    'id' => $format,
                    'title' => $url,
                    'errors' => $errors,
                ]],
                'details' => $result,
            ], $startedAt, $startTime);

            return response()->json([
                'result' => $result,
                'log' => $this->logPayload($log),
            ], empty($errors) ? 200 : 422);
        } catch (Throwable $exception) {
            $log = $this->recordFailure($request, $accountId, 'feed_check', $exception, $startedAt, $startTime);

            return response()->json([
                'message' => $exception->getMessage(),
                'log' => $this->logPayload($log),
            ], 422);
        }
    }

    public function feedCheck(Request $request)
    {
        return $this->checkFeed($request, (string) $request->input('format', 'csv'));
    }

    public function logs(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        $logs = MetaCatalogSyncLog::query()
            ->with('user:id,name,email')
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->latest('id')
            ->paginate(min(max((int) $request->input('per_page', 20), 1), 100));

        return response()->json($logs->through(fn (MetaCatalogSyncLog $log) => $this->logPayload($log)));
    }

    private function latestLogs(?int $accountId): array
    {
        return MetaCatalogSyncLog::query()
            ->with('user:id,name,email')
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->latest('id')
            ->limit(10)
            ->get()
            ->map(fn (MetaCatalogSyncLog $log) => $this->logPayload($log))
            ->all();
    }

    private function recordLog(Request $request, ?int $accountId, string $operation, string $status, array $result, $startedAt, float $startTime): MetaCatalogSyncLog
    {
        $invalidEntries = (array) ($result['invalid_entries'] ?? []);
        $skippedEntries = (array) ($result['skipped_entries'] ?? []);
        $fallbackEntries = (array) ($result['fallback_entries'] ?? []);
        $finishedAt = now();

        return MetaCatalogSyncLog::query()->create([
            'account_id' => $accountId,
            'user_id' => $request->user()?->id,
            'operation' => $operation,
            'status' => $status,
            'total_products' => (int) ($result['feed_count'] ?? 0),
            'valid_products' => (int) ($result['valid_count'] ?? 0),
            'invalid_products' => (int) ($result['invalid_count'] ?? 0),
            'success_count' => (int) ($result['request_count'] ?? $result['valid_count'] ?? 0),
            'error_count' => (int) ($result['invalid_count'] ?? 0),
            'create_count' => (int) ($result['create_count'] ?? 0),
            'update_count' => (int) ($result['update_count'] ?? 0),
            'delete_count' => (int) ($result['delete_count'] ?? 0),
            'fallback_count' => count($fallbackEntries),
            'duration_ms' => (int) round((microtime(true) - $startTime) * 1000),
            'summary' => $this->summaryFor($operation, $status, $result),
            'details' => [
                'invalid_entries' => $invalidEntries,
                'skipped_entries' => $skippedEntries,
                'skipped_count' => (int) ($result['skipped_count'] ?? count($skippedEntries)),
                'fallback_entries' => $fallbackEntries,
                'batches' => $result['batches'] ?? [],
                'details' => $result['details'] ?? null,
            ],
            'started_at' => $startedAt,
            'finished_at' => $finishedAt,
        ]);
    }

    private function recordFailure(Request $request, ?int $accountId, string $operation, Throwable $exception, $startedAt, float $startTime): MetaCatalogSyncLog
    {
        return MetaCatalogSyncLog::query()->create([
            'account_id' => $accountId,
            'user_id' => $request->user()?->id,
            'operation' => $operation,
            'status' => 'error',
            'error_count' => 1,
            'duration_ms' => (int) round((microtime(true) - $startTime) * 1000),
            'summary' => $exception->getMessage(),
            'error_message' => $exception->getMessage(),
            'details' => [
                'error' => $exception instanceof MetaCatalogProductSyncException
                    ? $exception->getMessage()
                    : Str::limit($exception->getMessage(), 2000, ''),
            ],
            'started_at' => $startedAt,
            'finished_at' => now(),
        ]);
    }

    private function summaryFor(string $operation, string $status, array $result): string
    {
        return sprintf(
            '%s %s: total %d, eligible %d, skipped %d, errors %d, create %d, update %d, delete %d, fallback %d.',
            $operation,
            $status,
            (int) ($result['feed_count'] ?? 0),
            (int) ($result['valid_count'] ?? 0),
            (int) ($result['skipped_count'] ?? count((array) ($result['skipped_entries'] ?? []))),
            (int) ($result['invalid_count'] ?? 0),
            (int) ($result['create_count'] ?? 0),
            (int) ($result['update_count'] ?? 0),
            (int) ($result['delete_count'] ?? 0),
            (int) ($result['fallback_count'] ?? count((array) ($result['fallback_entries'] ?? [])))
        );
    }

    private function logPayload(MetaCatalogSyncLog $log): array
    {
        return [
            'id' => (int) $log->id,
            'operation' => $log->operation,
            'status' => $log->status,
            'total_products' => $log->total_products,
            'valid_products' => $log->valid_products,
            'invalid_products' => $log->invalid_products,
            'skipped_count' => (int) data_get($log->details, 'skipped_count', count((array) data_get($log->details, 'skipped_entries', []))),
            'success_count' => $log->success_count,
            'error_count' => $log->error_count,
            'create_count' => $log->create_count,
            'update_count' => $log->update_count,
            'delete_count' => $log->delete_count,
            'fallback_count' => $log->fallback_count,
            'duration_ms' => $log->duration_ms,
            'summary' => $log->summary,
            'error_message' => $log->error_message,
            'details' => $log->details,
            'started_at' => $log->started_at?->toIso8601String(),
            'finished_at' => $log->finished_at?->toIso8601String(),
            'user' => $log->user ? [
                'id' => (int) $log->user->id,
                'name' => $log->user->name,
                'email' => $log->user->email,
            ] : null,
        ];
    }

    private function resolveAccountId(Request $request): ?int
    {
        $explicitAccountId = $request->input('account_id');
        if ($explicitAccountId && $explicitAccountId !== 'all') {
            return (int) $explicitAccountId;
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all' && is_numeric($headerAccountId)) {
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
