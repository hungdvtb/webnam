<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('site_domains')) {
            return;
        }

        $targetAccount = DB::table('accounts')
            ->where('site_code', 'tu')
            ->first(['id']);

        if (!$targetAccount) {
            return;
        }

        $domainId = $this->findDomainId('gomdaithanh.com');

        if (!$domainId) {
            return;
        }

        if (Schema::hasColumn('site_domains', 'account_id')) {
            DB::table('site_domains')
                ->where('id', $domainId)
                ->update(['account_id' => $targetAccount->id]);
        }

        if (Schema::hasColumn('accounts', 'public_domain_id')) {
            DB::table('accounts')
                ->where('public_domain_id', $domainId)
                ->where('id', '!=', $targetAccount->id)
                ->update(['public_domain_id' => null]);

            DB::table('accounts')
                ->where('id', $targetAccount->id)
                ->update(['public_domain_id' => $domainId]);
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('site_domains')) {
            return;
        }

        $targetAccount = DB::table('accounts')
            ->where('site_code', 'tu')
            ->first(['id']);

        if (!$targetAccount) {
            return;
        }

        $domainId = $this->findDomainId('gomdaithanh.com');

        if (!$domainId) {
            return;
        }

        if (Schema::hasColumn('accounts', 'public_domain_id')) {
            DB::table('accounts')
                ->where('id', $targetAccount->id)
                ->where('public_domain_id', $domainId)
                ->update(['public_domain_id' => null]);
        }

        // site_domains.account_id was created as NOT NULL in the legacy schema, so
        // leave the domain owner intact on rollback instead of guessing a prior id.
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
