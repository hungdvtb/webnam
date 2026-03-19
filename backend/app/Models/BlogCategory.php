<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlogCategory extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'slug',
        'sort_order',
    ];

    protected $casts = [
        'sort_order' => 'integer',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function posts()
    {
        return $this->hasMany(Post::class, 'blog_category_id');
    }
}

