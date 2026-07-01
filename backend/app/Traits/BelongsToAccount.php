<?php

namespace App\Traits;

use App\Models\Account;
use App\Services\AccountDataScopeService;
use Illuminate\Database\Eloquent\Builder;

trait BelongsToAccount
{
    /**
     * Boot the trait to attach global scope and event listener.
     */
    protected static function bootBelongsToAccount()
    {
        // Require account_id to be added on creation if not set out-of-band
        static::creating(function ($model) {
            $accountId = app(AccountDataScopeService::class)
                ->accountIdForCurrentRequest(static::accountScopeType());
            
            if ($accountId && empty($model->account_id)) {
                $model->account_id = $accountId;
            }
        });

        // Global scope for scoping records to the active account
        static::addGlobalScope('account_id', function (Builder $builder) {
            // Super Admin should probably see everything if they don't explicitly filter? 
            // Better to force even super admin to filter if they are acting on a specific admin view, 
            // but let's make it scoped via session/header for everyone.
            $accountId = session()->get('active_account_id') ?? request()->header('X-Account-Id');
            $scopeService = app(AccountDataScopeService::class);
            $scopeType = static::accountScopeType();

            if ($accountId && $accountId !== 'all') {
                $scopedAccountId = $scopeService->resolveScopedAccountId($accountId, $scopeType);
                if ($scopedAccountId) {
                    $builder->where($builder->getModel()->getTable() . '.account_id', $scopedAccountId);
                }
            } elseif (auth()->check() && !auth()->user()->is_admin) {
                $userAccountIds = auth()->user()->accounts()->pluck('accounts.id')->toArray();
                $userAccountIds = $scopeService->resolveScopedAccountIds($userAccountIds, $scopeType);
                if (empty($userAccountIds)) {
                    $builder->where($builder->getModel()->getTable() . '.account_id', 0);
                } else {
                    $builder->whereIn($builder->getModel()->getTable() . '.account_id', $userAccountIds);
                }
            }
        });
    }

    /**
     * Define the relationship to Account.
     */
    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    protected static function accountScopeType(): string
    {
        return property_exists(static::class, 'accountScopeType')
            ? static::$accountScopeType
            : AccountDataScopeService::SCOPE_ACTIVE;
    }
}
