<?php

namespace App\Console\Commands;

use App\Models\Banner;
use App\Models\Category;
use App\Models\Post;
use App\Models\ProductImage;
use App\Services\BlogMediaGallerySupport;
use App\Services\MediaService;
use Illuminate\Console\Command;

class MigrateMediaToR2 extends Command
{
    protected $signature = 'media:migrate-r2 {--skip-post-content : Skip rewriting blog content images}';

    protected $description = 'Migrate legacy local/external media references into Cloudflare R2-backed media assets.';

    public function handle(MediaService $mediaService): int
    {
        $summary = [
            'product_images' => 0,
            'category_banners' => 0,
            'category_logos' => 0,
            'post_featured_images' => 0,
            'post_content_images' => 0,
            'banner_images' => 0,
            'errors' => 0,
        ];

        $this->migrateProductImages($mediaService, $summary);
        $this->migrateCategories($mediaService, $summary);
        $this->migratePosts($mediaService, $summary, !$this->option('skip-post-content'));
        $this->migrateBanners($mediaService, $summary);

        $this->newLine();
        foreach ($summary as $key => $count) {
            $this->line(sprintf('%s: %d', $key, $count));
        }

        return self::SUCCESS;
    }

    private function migrateProductImages(MediaService $mediaService, array &$summary): void
    {
        ProductImage::query()
            ->whereNull('media_asset_id')
            ->whereNotNull('image_url')
            ->orderBy('id')
            ->chunkById(100, function ($images) use ($mediaService, &$summary) {
                foreach ($images as $image) {
                    try {
                        $asset = $mediaService->importFromReference($image->getRawOriginal('image_url'), [
                            'collection' => 'products',
                            'source' => 'migration-product-image',
                        ]);

                        if (!$asset) {
                            continue;
                        }

                        $image->update([
                            'media_asset_id' => $asset->id,
                            'image_url' => $mediaService->buildAssetUrl($asset, 'large'),
                        ]);

                        $summary['product_images']++;
                    } catch (\Throwable $exception) {
                        $summary['errors']++;
                        $this->warn('Product image #' . $image->id . ': ' . $exception->getMessage());
                    }
                }
            });
    }

    private function migrateCategories(MediaService $mediaService, array &$summary): void
    {
        Category::query()->orderBy('id')->chunkById(50, function ($categories) use ($mediaService, &$summary) {
            foreach ($categories as $category) {
                foreach ([
                    ['url' => 'banner_path', 'asset' => 'banner_media_asset_id', 'collection' => 'category-banners', 'summary' => 'category_banners'],
                    ['url' => 'logo_path', 'asset' => 'logo_media_asset_id', 'collection' => 'category-logos', 'summary' => 'category_logos'],
                ] as $mapping) {
                    if ($category->{$mapping['asset']} || !filled($category->getRawOriginal($mapping['url']))) {
                        continue;
                    }

                    try {
                        $asset = $mediaService->importFromReference($category->getRawOriginal($mapping['url']), [
                            'collection' => $mapping['collection'],
                            'source' => 'migration-category',
                        ]);

                        if (!$asset) {
                            continue;
                        }

                        $category->{$mapping['asset']} = $asset->id;
                        $category->{$mapping['url']} = $mediaService->buildAssetUrl($asset, 'large');
                        $category->save();
                        $summary[$mapping['summary']]++;
                    } catch (\Throwable $exception) {
                        $summary['errors']++;
                        $this->warn('Category #' . $category->id . ' ' . $mapping['url'] . ': ' . $exception->getMessage());
                    }
                }
            }
        });
    }

    private function migratePosts(MediaService $mediaService, array &$summary, bool $rewriteContent): void
    {
        Post::withTrashed()->orderBy('id')->chunkById(50, function ($posts) use ($mediaService, &$summary, $rewriteContent) {
            foreach ($posts as $post) {
                try {
                    if (!$post->featured_media_asset_id && filled($post->getRawOriginal('featured_image'))) {
                        $asset = $mediaService->importFromReference($post->getRawOriginal('featured_image'), [
                            'collection' => 'blog-featured',
                            'source' => 'migration-post-featured',
                        ]);

                        if ($asset) {
                            $post->featured_media_asset_id = $asset->id;
                            $post->featured_image = $mediaService->buildAssetUrl($asset, 'large');
                            $summary['post_featured_images']++;
                        }
                    }

                    if ($rewriteContent && filled($post->content)) {
                        $cache = [];
                        $rewritten = BlogMediaGallerySupport::rewriteAssetReferences(
                            (string) $post->content,
                            function (string $url) use ($mediaService, &$summary, &$cache) {
                                if ($mediaService->extractPublicIdFromUrl($url)) {
                                    return $url;
                                }

                                if (array_key_exists($url, $cache)) {
                                    return $cache[$url];
                                }

                                $asset = $mediaService->importFromReference($url, [
                                    'collection' => 'blog-editor',
                                    'source' => 'migration-post-content',
                                ]);

                                if (!$asset) {
                                    return $cache[$url] = $url;
                                }

                                $summary['post_content_images']++;
                                return $cache[$url] = $mediaService->buildAssetUrl($asset, 'large');
                            }
                        );

                        if ($rewritten !== $post->content) {
                            $post->content = $rewritten;
                        }
                    }

                    if ($post->isDirty()) {
                        $post->save();
                    }
                } catch (\Throwable $exception) {
                    $summary['errors']++;
                    $this->warn('Post #' . $post->id . ': ' . $exception->getMessage());
                }
            }
        });
    }

    private function migrateBanners(MediaService $mediaService, array &$summary): void
    {
        Banner::query()
            ->whereNull('media_asset_id')
            ->whereNotNull('image_url')
            ->orderBy('id')
            ->chunkById(50, function ($banners) use ($mediaService, &$summary) {
                foreach ($banners as $banner) {
                    try {
                        $asset = $mediaService->importFromReference($banner->getRawOriginal('image_url'), [
                            'collection' => 'banners',
                            'source' => 'migration-banner',
                        ]);

                        if (!$asset) {
                            continue;
                        }

                        $banner->update([
                            'media_asset_id' => $asset->id,
                            'image_url' => $mediaService->buildAssetUrl($asset, 'large'),
                        ]);

                        $summary['banner_images']++;
                    } catch (\Throwable $exception) {
                        $summary['errors']++;
                        $this->warn('Banner #' . $banner->id . ': ' . $exception->getMessage());
                    }
                }
            });
    }
}
