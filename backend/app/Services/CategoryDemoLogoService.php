<?php

namespace App\Services;

use App\Models\Category;
use Illuminate\Support\Str;

class CategoryDemoLogoService
{
    private const DEMO_BASE_PATH = 'category_logos/demo/';

    public function demoLogoPathFor(Category|string|null $category, ?string $slug = null): string
    {
        if ($category instanceof Category) {
            $name = (string) $category->name;
            $slug = (string) ($category->slug ?? '');
        } else {
            $name = (string) $category;
            $slug = (string) ($slug ?? '');
        }

        return self::DEMO_BASE_PATH . $this->resolveThemeKey($name, $slug) . '.svg';
    }

    public function isDemoLogoPath(?string $value): bool
    {
        $normalized = trim((string) $value);

        return $normalized !== '' && (
            Str::contains(Str::lower($normalized), '/category_logos/demo/')
            || Str::startsWith(Str::lower($normalized), Str::lower(self::DEMO_BASE_PATH))
        );
    }

    public function syncDemoLogoPath(Category $category): bool
    {
        $currentLogoPath = trim((string) $category->getRawOriginal('logo_path'));

        if ($category->logo_media_asset_id || ($currentLogoPath !== '' && !$this->isDemoLogoPath($currentLogoPath))) {
            return false;
        }

        $nextLogoPath = $this->demoLogoPathFor($category);

        if ($currentLogoPath === $nextLogoPath) {
            return false;
        }

        $category->forceFill([
            'logo_path' => $nextLogoPath,
        ]);

        if ($category->exists) {
            $category->saveQuietly();
        }

        return true;
    }

    public function backfillMissingLogoPaths(): int
    {
        $updatedCount = 0;

        Category::query()
            ->orderBy('id')
            ->get()
            ->each(function (Category $category) use (&$updatedCount): void {
                if ($this->syncDemoLogoPath($category)) {
                    $updatedCount++;
                }
            });

        return $updatedCount;
    }

    private function resolveThemeKey(string $name, string $slug): string
    {
        $haystack = $this->normalizeSearchText($name . ' ' . $slug);

        if ($this->containsAny($haystack, ['do tho', 'tho cung', 'ban tho', 'huong an'])) {
            return 'altar';
        }

        if ($this->containsAny($haystack, ['dia trang tri', 've tay', 've hoa', 'trang tri'])) {
            return 'painted-plate';
        }

        if ($this->containsAny($haystack, ['bat dia', 'men ran', 'chen dia', 'bat trang'])) {
            return 'crackle-tableware';
        }

        if ($this->containsAny($haystack, ['am tra', 'tra dao', 'tea'])) {
            return 'tea-set';
        }

        if ($this->containsAny($haystack, ['tranh', 'my thuat', 'nghe thuat'])) {
            return 'art-panel';
        }

        if ($this->containsAny($haystack, ['tuong', 'phong thuy', 'tu linh', 'di lac'])) {
            return 'statue';
        }

        return 'ceramic-placeholder';
    }

    private function normalizeSearchText(string $value): string
    {
        return Str::of($value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();
    }

    /**
     * @param  array<int, string>  $patterns
     */
    private function containsAny(string $haystack, array $patterns): bool
    {
        return collect($patterns)
            ->contains(fn (string $pattern) => Str::contains($haystack, $pattern));
    }
}
