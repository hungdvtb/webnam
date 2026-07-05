<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdAccountProfitCenter;
use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\ProfitCenter;
use App\Services\AccessControlService;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Rule;

class ProfitCenterController extends Controller
{
    public function __construct(
        private readonly AccessControlService $accessControl,
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->authorizeReportAccess($request, $accountId, ['reports.view', 'users.manage']);
        $this->ensureDefaultCenters($accountId);

        return response()->json([
            'profit_centers' => $this->profitCenterQuery($accountId)->get()->map(fn (ProfitCenter $center) => $this->profitCenterPayload($center))->values(),
            'ad_account_mappings' => $this->adMappingQuery($accountId)->get()->map(fn (AdAccountProfitCenter $mapping) => $this->adMappingPayload($mapping))->values(),
            'available_ad_accounts' => $this->availableAdAccountsPayload($accountId),
        ]);
    }

    public function store(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->authorizeReportAccess($request, $accountId, 'reports.update');

        $data = $this->validateProfitCenter($request);
        $data['account_id'] = $accountId;
        $data['code'] = $this->uniqueCode($accountId, $data['code'] ?? $data['name']);

        $center = ProfitCenter::query()->create($data);

        return response()->json($this->profitCenterPayload($center->load('manager')), 201);
    }

    public function update(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $this->authorizeReportAccess($request, $accountId, 'reports.update');

        $center = $this->profitCenterQuery($accountId)->findOrFail($id);
        $data = $this->validateProfitCenter($request, $center);
        if (array_key_exists('code', $data)) {
            $data['code'] = $this->uniqueCode($accountId, $data['code'] ?: $center->name, $center->id);
        }

        $center->fill($data)->save();

        return response()->json($this->profitCenterPayload($center->fresh('manager')));
    }

    public function destroy(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $this->authorizeReportAccess($request, $accountId, 'reports.update');

        $center = $this->profitCenterQuery($accountId)->findOrFail($id);
        $center->delete();

        return response()->json(['message' => 'Da xoa nhom quan ly lai lo.']);
    }

    public function saveAdMappings(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->authorizeReportAccess($request, $accountId, 'reports.update');

        $validated = $request->validate([
            'mappings' => 'present|array',
            'mappings.*.id' => 'nullable|integer|exists:ad_account_profit_centers,id',
            'mappings.*.platform' => ['required', 'string', Rule::in(['facebook', 'google'])],
            'mappings.*.external_account_id' => 'required|string|max:100',
            'mappings.*.external_account_name' => 'nullable|string|max:180',
            'mappings.*.profit_center_id' => 'nullable|integer|exists:profit_centers,id',
            'mappings.*.effective_from' => 'nullable|date',
            'mappings.*.effective_to' => 'nullable|date',
            'mappings.*.allocation_percent' => 'nullable|numeric|min:0|max:100',
            'mappings.*.is_active' => 'nullable|boolean',
        ]);

        $saved = DB::transaction(function () use ($accountId, $validated) {
            collect($validated['mappings'])
                ->filter(fn (array $row) => AdAccountProfitCenter::normalizeExternalAccountId($row['external_account_id'] ?? '') !== '')
                ->each(function (array $row) use ($accountId) {
                    $mapping = $this->saveAdMappingVersion($accountId, $row);
                    $this->refreshStoredSpendProfitCenters(
                        (string) $mapping->platform,
                        (string) $mapping->external_account_id
                    );
                });

            return $this->adMappingQuery($accountId)
                ->get()
                ->map(fn (AdAccountProfitCenter $mapping) => $this->adMappingPayload($mapping->load('profitCenter')))
                ->values();
        });

        return response()->json(['ad_account_mappings' => $saved]);
    }

    private function validateProfitCenter(Request $request, ?ProfitCenter $center = null): array
    {
        $rules = [
            'name' => 'required|string|max:160',
            'code' => 'nullable|string|max:80',
            'channel' => ['nullable', 'string', Rule::in(ProfitCenter::CHANNELS)],
            'manager_user_id' => 'nullable|integer|exists:users,id',
            'description' => 'nullable|string|max:5000',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ];

        $validated = $request->validate($rules);
        $validated['channel'] = $validated['channel'] ?? $center?->channel ?? ProfitCenter::CHANNEL_SHARED;
        $validated['is_active'] = (bool) ($validated['is_active'] ?? $center?->is_active ?? true);
        $validated['sort_order'] = (int) ($validated['sort_order'] ?? $center?->sort_order ?? 0);
        $validated['manager_user_id'] = !empty($validated['manager_user_id']) ? (int) $validated['manager_user_id'] : null;

        return $validated;
    }

    private function accountId(Request $request): ?int
    {
        $requestedAccountId = trim((string) $request->query('account_id', ''));
        if ($requestedAccountId !== '') {
            if ($requestedAccountId === 'all') {
                return null;
            }

            if (!ctype_digit($requestedAccountId)) {
                abort(422, 'account_id khong hop le.');
            }

            return (int) $requestedAccountId;
        }

        $accountId = $this->accessControl->resolveAccountIdFromRequest($request);

        return $accountId !== null ? (int) $accountId : null;
    }

    private function authorizeReportAccess(Request $request, ?int $accountId, string|array $permissions): void
    {
        $user = $request->user();
        $allowed = $user && collect((array) $permissions)->contains(
            fn (string $permission) => $this->accessControl->can($user, $permission, $accountId)
        );

        if (!$allowed) {
            abort(403, 'Ban khong co quyen quan ly nhom lai lo.');
        }
    }

    private function profitCenterQuery(?int $accountId)
    {
        return ProfitCenter::query()
            ->with('manager:id,name,email')
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name');
    }

    private function adMappingQuery(?int $accountId)
    {
        return AdAccountProfitCenter::query()
            ->with('profitCenter:id,name,code,manager_user_id')
            ->where('account_id', $accountId)
            ->orderBy('platform')
            ->orderBy('external_account_name')
            ->orderBy('external_account_id')
            ->orderBy('effective_from');
    }

    private function saveAdMappingVersion(?int $accountId, array $row): AdAccountProfitCenter
    {
        $platform = (string) ($row['platform'] ?? 'facebook');
        $externalId = AdAccountProfitCenter::normalizeExternalAccountId($row['external_account_id'] ?? '');
        $profitCenterId = !empty($row['profit_center_id']) ? (int) $row['profit_center_id'] : null;

        if ($profitCenterId !== null) {
            $this->profitCenterQuery($accountId)->findOrFail($profitCenterId);
        }

        $effectiveFrom = $this->parseDateOrDefault($row['effective_from'] ?? null, '1900-01-01');
        $requestedEffectiveTo = $this->parseNullableDate($row['effective_to'] ?? null);
        if ($requestedEffectiveTo && $requestedEffectiveTo->lt($effectiveFrom)) {
            throw ValidationException::withMessages([
                'mappings.effective_to' => 'Ngay ket thuc phai lon hon hoac bang ngay bat dau.',
            ]);
        }

        $baseQuery = AdAccountProfitCenter::query()
            ->where('account_id', $accountId)
            ->where('platform', $platform)
            ->where('external_account_id', $externalId);

        $existing = (clone $baseQuery)
            ->whereDate('effective_from', $effectiveFrom->toDateString())
            ->lockForUpdate()
            ->first();

        $next = (clone $baseQuery)
            ->whereDate('effective_from', '>', $effectiveFrom->toDateString())
            ->orderBy('effective_from')
            ->lockForUpdate()
            ->first();
        $latestAllowedEnd = $next?->effective_from
            ? CarbonImmutable::parse($next->effective_from)->subDay()
            : null;

        if ($requestedEffectiveTo && $latestAllowedEnd && $requestedEffectiveTo->gt($latestAllowedEnd)) {
            throw ValidationException::withMessages([
                'mappings.effective_to' => 'Khoang ngay bi chong voi moc gan ke tiep.',
            ]);
        }

        $effectiveTo = $requestedEffectiveTo ?? $latestAllowedEnd;

        $previous = (clone $baseQuery)
            ->whereDate('effective_from', '<', $effectiveFrom->toDateString())
            ->orderByDesc('effective_from')
            ->lockForUpdate()
            ->first();

        if ($previous) {
            $previousEnd = $previous->effective_to ? CarbonImmutable::parse($previous->effective_to) : null;
            if ($previousEnd === null || $previousEnd->gte($effectiveFrom)) {
                $previous->effective_to = $effectiveFrom->subDay()->toDateString();
                $previous->save();
            }
        }

        $attributes = [
            'account_id' => $accountId,
            'platform' => $platform,
            'external_account_id' => $externalId,
            'external_account_name' => $row['external_account_name'] ?? null,
            'profit_center_id' => $profitCenterId,
            'effective_from' => $effectiveFrom->toDateString(),
            'effective_to' => $effectiveTo?->toDateString(),
            'allocation_percent' => (float) ($row['allocation_percent'] ?? 100),
            'is_active' => (bool) ($row['is_active'] ?? true),
        ];

        if ($existing) {
            $existing->fill($attributes)->save();

            return $existing->fresh();
        }

        return AdAccountProfitCenter::query()->create($attributes);
    }

    private function refreshStoredSpendProfitCenters(string $platform, string $externalAccountId): void
    {
        if (!ctype_digit($externalAccountId)) {
            return;
        }

        DailyAdsSpend::query()
            ->where('platform', $platform)
            ->where('account_id', (int) $externalAccountId)
            ->pluck('date')
            ->map(fn ($date) => CarbonImmutable::parse($date)->toDateString())
            ->unique()
            ->each(function (string $date) use ($platform, $externalAccountId) {
                DailyAdsSpend::query()
                    ->where('platform', $platform)
                    ->where('account_id', (int) $externalAccountId)
                    ->whereDate('date', $date)
                    ->update([
                        'profit_center_id' => AdAccountProfitCenter::resolveProfitCenterId($platform, $externalAccountId, $date),
                    ]);
            });
    }

    private function parseDateOrDefault(mixed $value, string $default): CarbonImmutable
    {
        $raw = trim((string) $value);

        return CarbonImmutable::parse($raw !== '' ? $raw : $default)->startOfDay();
    }

    private function parseNullableDate(mixed $value): ?CarbonImmutable
    {
        $raw = trim((string) $value);

        return $raw !== '' ? CarbonImmutable::parse($raw)->startOfDay() : null;
    }

    private function availableAdAccountsPayload(?int $accountId): array
    {
        $items = [];
        $configQuery = FinDailyReportConfig::query();

        if (Schema::hasColumn('fin_daily_report_configs', 'account_id')) {
            $configQuery
                ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
                ->when($accountId === null, fn ($query) => $query->whereNull('account_id'));
        }

        $config = $configQuery->orderBy('id')->first();

        if (!$config && $accountId !== null && Schema::hasColumn('fin_daily_report_configs', 'account_id')) {
            $config = FinDailyReportConfig::query()
                ->whereNull('account_id')
                ->orderBy('id')
                ->first();
        }

        if ($config) {
            foreach ($this->configuredFacebookAccountIds($config) as $id) {
                $this->rememberAdAccountCandidate($items, DailyAdsSpend::PLATFORM_FACEBOOK, $id);
            }

            foreach ($this->splitAccountIds($config->google_customer_ids ?? '') as $id) {
                $this->rememberAdAccountCandidate($items, DailyAdsSpend::PLATFORM_GOOGLE, $id);
            }
        }

        $this->adMappingQuery($accountId)
            ->get()
            ->each(function (AdAccountProfitCenter $mapping) use (&$items) {
                $this->rememberAdAccountCandidate(
                    $items,
                    (string) $mapping->platform,
                    (string) $mapping->external_account_id,
                    (string) ($mapping->external_account_name ?? ''),
                    true
                );
            });

        DailyAdsSpend::query()
            ->whereNotNull('account_id')
            ->select('platform', 'account_id')
            ->distinct()
            ->get()
            ->each(function (DailyAdsSpend $spend) use (&$items) {
                $this->rememberAdAccountCandidate($items, (string) $spend->platform, (string) $spend->account_id);
            });

        return collect($items)
            ->sortBy([
                ['platform', 'asc'],
                ['external_account_name', 'asc'],
                ['external_account_id', 'asc'],
            ])
            ->values()
            ->all();
    }

    private function configuredFacebookAccountIds(FinDailyReportConfig $config): array
    {
        $ids = $this->splitAccountIds($config->fb_ad_account_ids ?? '');

        foreach ((array) ($config->fb_tokens_configs ?? []) as $tokenConfig) {
            $ids = array_merge($ids, $this->splitAccountIds($tokenConfig['account_ids'] ?? ''));
        }

        return array_values(array_unique($ids));
    }

    private function splitAccountIds(mixed $value): array
    {
        return collect(preg_split('/[,\s]+/', (string) $value) ?: [])
            ->map(fn ($id) => AdAccountProfitCenter::normalizeExternalAccountId($id))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function rememberAdAccountCandidate(array &$items, string $platform, mixed $externalAccountId, string $name = '', bool $isMapped = false): void
    {
        $externalId = AdAccountProfitCenter::normalizeExternalAccountId($externalAccountId);
        if ($externalId === '') {
            return;
        }

        $key = $platform . ':' . $externalId;
        $existing = $items[$key] ?? null;

        $items[$key] = [
            'platform' => $platform,
            'external_account_id' => $externalId,
            'external_account_name' => $name !== '' ? $name : ($existing['external_account_name'] ?? ''),
            'is_mapped' => $isMapped || (bool) ($existing['is_mapped'] ?? false),
        ];
    }

    private function ensureDefaultCenters(?int $accountId): void
    {
        return;
    }

    private function uniqueCode(?int $accountId, mixed $value, ?int $ignoreId = null): string
    {
        $base = Str::slug(Str::ascii((string) $value)) ?: 'quan-ly';
        $code = substr($base, 0, 72);
        $suffix = 2;

        while (
            ProfitCenter::query()
                ->where('account_id', $accountId)
                ->where('code', $code)
                ->when($ignoreId, fn ($query) => $query->where('id', '!=', $ignoreId))
                ->exists()
        ) {
            $code = substr($base, 0, 68) . '-' . $suffix;
            $suffix++;
        }

        return $code;
    }

    private function profitCenterPayload(ProfitCenter $center): array
    {
        return [
            'id' => (int) $center->id,
            'account_id' => $center->account_id ? (int) $center->account_id : null,
            'name' => (string) $center->name,
            'code' => (string) $center->code,
            'channel' => (string) $center->channel,
            'manager_user_id' => $center->manager_user_id ? (int) $center->manager_user_id : null,
            'manager_name' => $center->manager?->name,
            'description' => (string) ($center->description ?? ''),
            'is_active' => (bool) $center->is_active,
            'sort_order' => (int) ($center->sort_order ?? 0),
        ];
    }

    private function adMappingPayload(AdAccountProfitCenter $mapping): array
    {
        return [
            'id' => (int) $mapping->id,
            'account_id' => $mapping->account_id ? (int) $mapping->account_id : null,
            'platform' => (string) $mapping->platform,
            'external_account_id' => (string) $mapping->external_account_id,
            'external_account_name' => (string) ($mapping->external_account_name ?? ''),
            'profit_center_id' => $mapping->profit_center_id ? (int) $mapping->profit_center_id : null,
            'profit_center_name' => $mapping->profitCenter?->name,
            'effective_from' => $mapping->effective_from ? CarbonImmutable::parse($mapping->effective_from)->toDateString() : null,
            'effective_to' => $mapping->effective_to ? CarbonImmutable::parse($mapping->effective_to)->toDateString() : null,
            'allocation_percent' => (float) ($mapping->allocation_percent ?? 100),
            'is_active' => (bool) $mapping->is_active,
            'is_current' => (bool) $mapping->is_active
                && (!$mapping->effective_from || CarbonImmutable::parse($mapping->effective_from)->lte(today()))
                && (!$mapping->effective_to || CarbonImmutable::parse($mapping->effective_to)->gte(today())),
        ];
    }
}
