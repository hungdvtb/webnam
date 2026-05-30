<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ProductReview extends Model
{
    use \App\Traits\BelongsToAccount;

    public const STATUS_PENDING = 'pending';
    public const STATUS_VISIBLE = 'visible';
    public const STATUS_HIDDEN = 'hidden';

    public const SOURCE_CUSTOMER_WEB = 'customer_web';
    public const SOURCE_ADMIN_MANUAL = 'admin_manual';
    public const SOURCE_ADMIN_IMPORT = 'admin_import';
    public const SOURCE_ADMIN_SAMPLE = 'admin_sample';

    protected $fillable = [
        'account_id',
        'product_id',
        'parent_id',
        'user_id',
        'author_type',
        'source_type',
        'customer_name',
        'is_anonymous',
        'rating',
        'comment',
        'is_approved',
        'status',
        'helpful_count',
        'customer_ip_hash',
        'customer_user_agent',
        'admin_seen_at',
        'created_at',
    ];

    protected $casts = [
        'is_approved' => 'boolean',
        'is_anonymous' => 'boolean',
        'helpful_count' => 'integer',
        'rating' => 'float',
        'admin_seen_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function replies()
    {
        return $this->hasMany(self::class, 'parent_id')->oldest();
    }

    public function visibleReplies()
    {
        return $this->replies()->visible();
    }

    public function likes()
    {
        return $this->hasMany(ProductReviewLike::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function scopeVisible($query)
    {
        return $query
            ->where('is_approved', true)
            ->where(function ($statusQuery) {
                $statusQuery
                    ->where('status', self::STATUS_VISIBLE)
                    ->orWhereNull('status');
            });
    }

    public function scopeTopLevel($query)
    {
        return $query->whereNull('parent_id');
    }

    public function isReply(): bool
    {
        return filled($this->parent_id);
    }
}
