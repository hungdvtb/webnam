<?php

namespace Tests\Unit;

use App\Models\InventoryDocument;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class InventoryDocumentOptionalSoftDeletesTest extends TestCase
{
    protected function tearDown(): void
    {
        InventoryDocument::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();

        parent::tearDown();
    }

    public function test_query_does_not_require_deleted_at_when_column_is_missing(): void
    {
        InventoryDocument::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();

        Schema::shouldReceive('connection')->andReturnSelf();
        Schema::shouldReceive('hasTable')->with('inventory_documents')->andReturn(true);
        Schema::shouldReceive('hasColumn')->with('inventory_documents', 'deleted_at')->andReturn(false);

        $defaultSql = InventoryDocument::query()->toSql();
        $withTrashedSql = InventoryDocument::withTrashed()->toSql();
        $onlyTrashedSql = InventoryDocument::onlyTrashed()->toSql();

        $this->assertStringNotContainsString('deleted_at', $defaultSql);
        $this->assertStringNotContainsString('deleted_at', $withTrashedSql);
        $this->assertStringNotContainsString('deleted_at', $onlyTrashedSql);
        $this->assertStringContainsString('1 = 0', $onlyTrashedSql);
    }
}
