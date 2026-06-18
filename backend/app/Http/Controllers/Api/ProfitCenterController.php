<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdAccountProfitCenter;
use App\Models\ProfitCenter;
use App\Services\AccessControlService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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
            'mappings.*.allocation_percent' => 'nullable|numeric|min:0|max:100',
            'mappings.*.is_active' => 'nullable|boolean',
        ]);

        $saved = DB::transaction(function () use ($accountId, $validated) {
            $savedMappings = collect($validated['mappings'])
                ->map(function (array $row) use ($accountId) {
                    $externalId = AdAccountProfitCenter::normalizeExternalAccountId($row['external_account_id'] ?? '');
                    $profitCenterId = !empty($row['profit_center_id']) ? (int) $row['profit_center_id'] : null;

                    if ($profitCenterId !== null) {
                        $this->profitCenterQuery($accountId)->findOrFail($profitCenterId);
                    }

                    return AdAccountProfitCenter::query()->updateOrCreate(
                        [
                            'account_id' => $accountId,
                            'platform' => $row['platform'],
                            'external_account_id' => $externalId,
                        ],
                        [
                            'external_account_name' => $row['external_account_name'] ?? null,
                            'profit_center_id' => $profitCenterId,
                            'allocation_percent' => (float) ($row['allocation_percent'] ?? 100),
                            'is_active' => (bool) ($row['is_active'] ?? true),
                        ]
                    );
                })
                ->values();

            $savedIds = $savedMappings->pluck('id')->map(fn ($id) => (int) $id)->filter()->values()->all();
            AdAccountProfitCenter::query()
                ->where('account_id', $accountId)
                ->when($savedIds !== [], fn ($query) => $query->whereNotIn('id', $savedIds))
                ->when($savedIds === [], fn ($query) => $query)
                ->delete();

            return $savedMappings
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
            ->orderBy('external_account_id');
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
            'allocation_percent' => (float) ($mapping->allocation_percent ?? 100),
            'is_active' => (bool) $mapping->is_active,
        ];
    }
}
