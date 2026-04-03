<?php

namespace App\Support;

use App\Models\SiteDomain;

class PublicSiteUrlResolver
{
    public function buildBlogPath(?string $slug): string
    {
        $normalizedSlug = trim((string) $slug);

        if ($normalizedSlug === '') {
            return '';
        }

        return '/blog/' . rawurlencode($normalizedSlug);
    }

    public function buildBlogUrl(?string $slug, ?int $accountId = null): string
    {
        $path = $this->buildBlogPath($slug);

        if ($path === '') {
            return '';
        }

        $baseUrl = $this->resolveBaseUrl($accountId);

        return $baseUrl ? rtrim($baseUrl, '/') . $path : $path;
    }

    public function resolveBaseUrl(?int $accountId = null): ?string
    {
        $candidates = [];

        if ($accountId) {
            $candidates[] = $this->resolveSiteDomainBaseUrl($accountId);
        }

        $candidates[] = config('app.frontend_url');
        $candidates[] = config('app.admin_url');

        foreach ($candidates as $candidate) {
            $normalized = $this->normalizeBaseUrl($candidate);

            if ($normalized !== null) {
                return $normalized;
            }
        }

        return null;
    }

    public function normalizeBaseUrl(?string $value): ?string
    {
        $candidate = trim((string) $value);

        if ($candidate === '') {
            return null;
        }

        if (!preg_match('/^https?:\/\//i', $candidate)) {
            $candidate = 'https://' . ltrim($candidate, '/');
        }

        $parts = parse_url($candidate);

        if (!$parts || empty($parts['host'])) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $host = strtolower((string) $parts['host']);

        if (str_starts_with($host, 'admin.')) {
            $host = substr($host, strlen('admin.'));
        }

        if ($host === '') {
            return null;
        }

        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = trim((string) ($parts['path'] ?? ''), '/');

        return $scheme . '://' . $host . $port . ($path !== '' ? '/' . $path : '');
    }

    private function resolveSiteDomainBaseUrl(int $accountId): ?string
    {
        $domains = SiteDomain::query()
            ->where('account_id', $accountId)
            ->orderByDesc('is_default')
            ->orderByDesc('is_active')
            ->orderBy('id')
            ->get(['domain', 'is_active', 'is_default']);

        $siteDomain = $domains->first(
            fn (SiteDomain $domain) => (bool) $domain->is_active && (bool) $domain->is_default
        ) ?? $domains->first(
            fn (SiteDomain $domain) => (bool) $domain->is_active
        ) ?? $domains->first(
            fn (SiteDomain $domain) => (bool) $domain->is_default
        ) ?? $domains->first();

        return $siteDomain ? $this->normalizeBaseUrl((string) $siteDomain->domain) : null;
    }
}
