<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('site_domains') || !Schema::hasColumn('accounts', 'public_domain_id')) {
            return;
        }

        $domainId = $this->findDomainId('gomdaithanh.com');
        if (!$domainId) {
            return;
        }

        DB::table('accounts')
            ->whereIn('site_code', ['GSDT', 'tu'])
            ->update(['public_domain_id' => $domainId]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('site_domains') || !Schema::hasColumn('accounts', 'public_domain_id')) {
            return;
        }

        $domainId = $this->findDomainId('gomdaithanh.com');
        if (!$domainId) {
            return;
        }

        DB::table('accounts')
            ->whereIn('site_code', ['GSDT', 'tu'])
            ->where('public_domain_id', $domainId)
            ->update(['public_domain_id' => null]);
    }

    private function findDomainId(string $targetHost): ?int
    {
        $normalizedTarget = $this->normalizeHost($targetHost);

        return DB::table('site_domains')
            ->get(['id', 'domain'])
            ->first(function ($domain) use ($normalizedTarget) {
                $host = $this->normalizeHost($domain->domain ?? '');

                return $host === $normalizedTarget || $host === 'www.' . $normalizedTarget;
            })
            ?->id;
    }

    private function normalizeHost(mixed $value): string
    {
        $raw = strtolower(trim((string) $value));

        if ($raw === '') {
            return '';
        }

        if (!preg_match('#^[a-z][a-z0-9+.-]*://#i', $raw)) {
            $raw = 'https://' . ltrim($raw, '/');
        }

        $host = parse_url($raw, PHP_URL_HOST);

        if (!is_string($host)) {
            return '';
        }

        return trim(strtolower($host), " \t\n\r\0\x0B.");
    }
};
