<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    use HasFactory;

    protected $fillable = [
        'account_id',
        'name',
        'email',
        'phone',
        'address',
        'group',
        'total_spent',
        'total_orders',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    protected function setEmailAttribute($value): void
    {
        $normalized = trim((string) ($value ?? ''));
        $this->attributes['email'] = $normalized === '' ? null : $normalized;
    }

    protected function setPhoneAttribute($value): void
    {
        $normalized = trim((string) ($value ?? ''));
        $this->attributes['phone'] = $normalized === '' ? null : $normalized;
    }

    public function orders()
    {
        return $this->hasMany(Order::class);
    }
}
