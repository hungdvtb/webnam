<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PostSeoKeyword extends Model
{
    protected $fillable = [
        'account_id',
        'keyword',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
