<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Support\BatTrangCategoryBranding;
use App\Support\BatTrangCategoryCatalog;
use Illuminate\Database\Seeder;

class BatTrangCategorySystemSeeder extends Seeder
{
    private const ACCOUNT_ID = 1;

    public function run(): void
    {
        $branding = new BatTrangCategoryBranding(public_path('category_assets/bat-trang-categories'));
        $persisted = [];

        foreach (BatTrangCategoryCatalog::definitions() as $definition) {
            $assets = $branding->generate($definition);
            $parentId = $definition['parent_key'] ? ($persisted[$definition['parent_key']]->id ?? null) : null;

            $category = Category::withoutGlobalScopes()
                ->withTrashed()
                ->firstOrNew([
                    'account_id' => self::ACCOUNT_ID,
                    'code' => $definition['code'],
                ]);

            $category->forceFill([
                'account_id' => self::ACCOUNT_ID,
                'name' => $definition['name'],
                'code' => $definition['code'],
                'slug' => $definition['slug'],
                'parent_id' => $parentId,
                'description' => $definition['description'],
                'meta_title' => $definition['meta_title'],
                'meta_description' => $definition['meta_description'],
                'meta_keywords' => $definition['meta_keywords'],
                'banner_path' => $assets['banner_path'],
                'banner_media_asset_id' => null,
                'logo_path' => $assets['logo_path'],
                'logo_media_asset_id' => null,
                'status' => true,
                'order' => $definition['order'],
                'display_layout' => 'layout_1',
                'filterable_attribute_ids' => [],
                'deleted_at' => null,
                'deleted_by' => null,
            ]);

            $category->save();
            $persisted[$definition['key']] = $category;
        }

        if ($this->command) {
            $this->command->info('Bat Trang category system seeded: ' . count($persisted) . ' categories.');
        }
    }
}
