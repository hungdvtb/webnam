<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BlogPost extends Model
{
    use HasFactory;

    protected $fillable = [
        'account_id',
        'title',
        'slug',
        'content',
        'image',
        'meta_title',
        'meta_description',
        'status',
    ];
}
