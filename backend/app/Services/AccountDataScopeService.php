<?php

namespace App\Services;

use App\Models\Account;
use Illuminate\Http\Request;

class AccountDataScopeService
{
    public const SCOPE_ACTIVE = 'active';
    public const SCOPE_CATALOG = 'catalog';
    public const SCOPE_INVENTORY = 'inventory';

    public function rawActiveAccountId(?Request $request = null): ?int
    {
        $request ??= request();
        $rawAccountId = session()->get('active_account_id') ?? $request->header('X-Account-Id');

        return $this->normalizeAccountId($rawAccountId);
    }

    public function accountIdForCurrentRequest(string $scope = self::SCOPE_ACTIVE): ?int
    {
        $accountId = $this->rawActiveAccountId();

        if ($accountId === null && auth()->check()) {
            $accountId = auth()->user()->accounts()->orderBy('accounts.id')->value('accounts.id');

            if ($accountId === null && auth()->user()->is_admin) {
                $accountId = Account::query()->orderBy('id')->value('id');
            }
        }

        return $this->resolveScopedAccountId($accountId, $scope);
    }

    public function catalogAccountId(?int $accountId): ?int
    {
        return $this->resolveScopedAccountId($accountId, self::SCOPE_CATALOG);
    }

    public function inventoryAccountId(?int $accountId): ?int
    {
        return $this->resolveScopedAccountId($accountId, self::SCOPE_INVENTORY);
    }

    public function catalogAccountIdForRequest(Request $request): ?int
    {
        return $this->catalogAccountId($this->rawActiveAccountId($request));
    }

    public function inventoryAccountIdForRequest(Request $request): ?int
    {
        return $this->inventoryAccountId($this->rawActiveAccountId($request));
    }

    public function resolveScopedAccountId($accountId, string $scope = self::SCOPE_ACTIVE): ?int
    {
        $normalizedAccountId = $this->normalizeAccountId($accountId);
        if ($normalizedAccountId === null) {
            return null;
        }

        return match ($scope) {
            self::SCOPE_CATALOG => $this->resolveLinkedAccountId($normalizedAccountId, 'catalog_account_id'),
            self::SCOPE_INVENTORY => $this->resolveLinkedAccountId($normalizedAccountId, 'inventory_account_id'),
            default => $normalizedAccountId,
        };
    }

    public function resolveScopedAccountIds(iterable $accountIds, string $scope = self::SCOPE_ACTIVE): array
    {
        return collect($accountIds)
            ->map(fn ($accountId) => $this->resolveScopedAccountId($accountId, $scope))
            ->filter()
            ->map(fn ($accountId) => (int) $accountId)
            ->unique()
            ->values()
            ->all();
    }

    public function accountIdsSharingInventoryScope(?int $inventoryAccountId): array
    {
        $resolvedInventoryAccountId = $this->inventoryAccountId($inventoryAccountId);
        if ($resolvedInventoryAccountId === null) {
            return [];
        }

        $candidateIds = Account::query()
            ->pluck('inventory_account_id', 'id')
            ->filter(fn ($linkedAccountId, $accountId) => $this->inventoryAccountId((int) $accountId) === $resolvedInventoryAccountId)
            ->keys();

        return $candidateIds
            ->merge([$resolvedInventoryAccountId])
            ->map(fn ($accountId) => (int) $accountId)
            ->unique()
            ->values()
            ->all();
    }

    public function accountIdsSharingInventoryScopeForRequest(Request $request): array
    {
        return $this->accountIdsSharingInventoryScope($this->rawActiveAccountId($request));
    }

    public function normalizeAccountId($accountId): ?int
    {
        if ($accountId === null || $accountId === '' || $accountId === 'all') {
            return null;
        }

        if (!is_numeric($accountId)) {
            return null;
        }

        $normalizedAccountId = (int) $accountId;

        return $normalizedAccountId > 0 ? $normalizedAccountId : null;
    }

    private function resolveLinkedAccountId(int $accountId, string $column): int
    {
        $currentAccountId = $accountId;
        $visited = [];

        for ($attempt = 0; $attempt < 10; $attempt++) {
            if (isset($visited[$currentAccountId])) {
                return $currentAccountId;
            }

            $visited[$currentAccountId] = true;
            $nextAccountId = Account::query()
                ->whereKey($currentAccountId)
                ->value($column);

            $nextAccountId = $this->normalizeAccountId($nextAccountId);
            if ($nextAccountId === null || $nextAccountId === $currentAccountId) {
                return $currentAccountId;
            }

            $targetExists = Account::query()->whereKey($nextAccountId)->exists();
            if (!$targetExists) {
                return $currentAccountId;
            }

            $currentAccountId = $nextAccountId;
        }

        return $currentAccountId;
    }
}
