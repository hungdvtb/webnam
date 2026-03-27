<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\SoftDeletingScope;
use Illuminate\Support\Facades\Schema;

trait OptionalSoftDeletes
{
    use SoftDeletes {
        bootSoftDeletes as private bootLaravelSoftDeletes;
        initializeSoftDeletes as private initializeLaravelSoftDeletes;
        restore as private restoreLaravelSoftDeletes;
        trashed as private trashedLaravelSoftDeletes;
        forceDelete as private forceDeleteLaravelSoftDeletes;
        performDeleteOnModel as private performDeleteOnModelLaravelSoftDeletes;
    }

    protected static array $optionalSoftDeleteColumnCache = [];

    protected static function bootSoftDeletes(): void
    {
        $instance = new static();

        if ($instance->supportsSoftDeletes()) {
            static::bootLaravelSoftDeletes();
        }
    }

    public function initializeSoftDeletes(): void
    {
        if ($this->supportsSoftDeletes()) {
            $this->initializeLaravelSoftDeletes();
        }
    }

    public function scopeWithTrashed(Builder $query, $withTrashed = true): Builder
    {
        if (! $withTrashed) {
            return $this->scopeWithoutTrashed($query);
        }

        if (! $this->supportsSoftDeletes()) {
            return $query;
        }

        return $query->withoutGlobalScope(SoftDeletingScope::class);
    }

    public function scopeOnlyTrashed(Builder $query): Builder
    {
        if (! $this->supportsSoftDeletes()) {
            return $query->whereRaw('1 = 0');
        }

        return $query
            ->withoutGlobalScope(SoftDeletingScope::class)
            ->whereNotNull($query->getModel()->getQualifiedDeletedAtColumn());
    }

    public function scopeWithoutTrashed(Builder $query): Builder
    {
        if (! $this->supportsSoftDeletes()) {
            return $query;
        }

        return $query
            ->withoutGlobalScope(SoftDeletingScope::class)
            ->whereNull($query->getModel()->getQualifiedDeletedAtColumn());
    }

    public function restore()
    {
        if (! $this->supportsSoftDeletes()) {
            return false;
        }

        return $this->restoreLaravelSoftDeletes();
    }

    public function trashed(): bool
    {
        return $this->supportsSoftDeletes()
            ? $this->trashedLaravelSoftDeletes()
            : false;
    }

    public function forceDelete()
    {
        if (! $this->supportsSoftDeletes()) {
            return $this->delete();
        }

        return $this->forceDeleteLaravelSoftDeletes();
    }

    protected function performDeleteOnModel()
    {
        if ($this->supportsSoftDeletes()) {
            $this->performDeleteOnModelLaravelSoftDeletes();

            return;
        }

        $this->setKeysForSaveQuery($this->newModelQuery())->delete();
        $this->exists = false;
    }

    public static function forgetOptionalSoftDeleteSupportCache(): void
    {
        static::$optionalSoftDeleteColumnCache = [];
    }

    protected function supportsSoftDeletes(): bool
    {
        $connection = $this->getConnectionName() ?: config('database.default');
        $cacheKey = implode('|', [
            $connection,
            $this->getTable(),
            $this->getDeletedAtColumn(),
        ]);

        if (! array_key_exists($cacheKey, static::$optionalSoftDeleteColumnCache)) {
            $schema = Schema::connection($connection);

            static::$optionalSoftDeleteColumnCache[$cacheKey] = $schema->hasTable($this->getTable())
                && $schema->hasColumn($this->getTable(), $this->getDeletedAtColumn());
        }

        return static::$optionalSoftDeleteColumnCache[$cacheKey];
    }
}
