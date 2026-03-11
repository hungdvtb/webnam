<?php

namespace App\Traits;

use App\Models\Account;
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
            $accountId = session()->get('active_account_id') ?? request()->header('X-Account-Id');
            
            if (!$accountId && auth()->check()) {
                // If no explicit account is given, default to the first account this user has access to.
                $accountId = auth()->user()->accounts()->first()?->id;
                
                // If still no account (e.g., brand new superadmin without accounts?), 
                // we might try to grab the very first account in the system as a fallback.
                if (!$accountId && auth()->user()->is_admin) {
                     $accountId = Account::first()?->id;
                }
            }

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

            if ($accountId && $accountId !== 'all') {
                $builder->where($builder->getModel()->getTable() . '.account_id', $accountId);
            } elseif (auth()->check() && !auth()->user()->is_admin) {
                $userAccountIds = auth()->user()->accounts()->pluck('accounts.id')->toArray();
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
}
