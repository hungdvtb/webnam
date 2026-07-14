<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\SiteDomain;
use App\Models\Store;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class SiteDomainController extends Controller
{
    public function index(Request $request)
    {
        if (($request->boolean('all') || $request->query('scope') === 'all') && $request->user()?->is_admin) {
            $domains = SiteDomain::query()
                ->with('account:id,name')
                ->orderBy('domain')
                ->get();

            return response()->json($domains);
        }

        $accountId = $this->getAccountId($request);
        if (!$accountId) {
             return response()->json([]);
        }

        $sharedDomainIds = collect();

        if (Schema::hasColumn('accounts', 'public_domain_id')) {
            $sharedDomainIds = $sharedDomainIds->merge(
                Account::query()
                    ->whereKey($accountId)
                    ->whereNotNull('public_domain_id')
                    ->pluck('public_domain_id')
            );
        }

        if (Schema::hasTable('stores') && Schema::hasColumn('stores', 'public_domain_id')) {
            $sharedDomainIds = $sharedDomainIds->merge(
                Store::withoutGlobalScopes()
                    ->where('account_id', $accountId)
                    ->whereNotNull('public_domain_id')
                    ->pluck('public_domain_id')
            );
        }

        $sharedDomainIds = $sharedDomainIds
            ->map(fn ($domainId) => is_numeric($domainId) ? (int) $domainId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $domains = SiteDomain::query()
            ->where(function ($query) use ($accountId, $sharedDomainIds) {
                $query->where('account_id', $accountId);

                if ($sharedDomainIds !== []) {
                    $query->orWhereIn('id', $sharedDomainIds);
                }
            })
            ->orderBy('domain')
            ->get();

        return response()->json($domains);
    }

    public function store(Request $request)
    {
        $accountId = $this->getAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account Id is required'], 400);
        }

        $validated = $request->validate([
            'domain' => ['required', 'string', 'max:255'],
            'is_default' => ['sometimes', 'boolean'],
        ]);

        $domainValue = $this->normalizeDomainInput($validated['domain']);
        if ($domainValue === '') {
            throw ValidationException::withMessages([
                'domain' => ['Ten mien khong hop le.'],
            ]);
        }

        $this->ensureDomainIsAvailable($domainValue, (int) $accountId);

        if ($request->boolean('is_default')) {
            SiteDomain::where('account_id', $accountId)->update(['is_default' => false]);
        }

        $domain = SiteDomain::create([
            'account_id' => $accountId,
            'domain' => $domainValue,
            'is_active' => true,
            'is_default' => $request->boolean('is_default'),
        ]);

        return response()->json($domain);
    }

    public function update(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $domain = SiteDomain::where('account_id', $accountId)->findOrFail($id);

        $validated = $request->validate([
            'domain' => ['sometimes', 'required', 'string', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
            'is_default' => ['sometimes', 'boolean'],
        ]);

        $updates = [];
        if (array_key_exists('domain', $validated)) {
            $domainValue = $this->normalizeDomainInput($validated['domain']);
            if ($domainValue === '') {
                throw ValidationException::withMessages([
                    'domain' => ['Ten mien khong hop le.'],
                ]);
            }

            $this->ensureDomainIsAvailable($domainValue, (int) $accountId, (int) $domain->id);
            $updates['domain'] = $domainValue;
        }

        if (array_key_exists('is_active', $validated)) {
            $updates['is_active'] = (bool) $validated['is_active'];
        }

        if ($request->boolean('is_default')) {
            SiteDomain::where('account_id', $accountId)->update(['is_default' => false]);
            $updates['is_default'] = true;
        } elseif (array_key_exists('is_default', $validated)) {
            $updates['is_default'] = (bool) $validated['is_default'];
        }

        $domain->update($updates);

        return response()->json($domain);
    }

    public function destroy(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $domain = SiteDomain::where('account_id', $accountId)->findOrFail($id);
        $domain->delete();

        return response()->json(['message' => 'Domain deleted successfully']);
    }

    private function getAccountId(Request $request)
    {
        $accountId = null;
        if ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $accountId = $request->header('X-Account-Id');
        }
        return $accountId;
    }

    private function ensureDomainIsAvailable(string $domain, int $accountId, ?int $ignoreId = null): void
    {
        $existingDomain = SiteDomain::query()
            ->with('account:id,name')
            ->get(['id', 'account_id', 'domain'])
            ->first(function (SiteDomain $siteDomain) use ($domain, $ignoreId) {
                if ($ignoreId && (int) $siteDomain->id === $ignoreId) {
                    return false;
                }

                return $this->domainMatches($siteDomain->domain, $domain);
            });

        if (!$existingDomain) {
            return;
        }

        if ((int) $existingDomain->account_id === $accountId) {
            throw ValidationException::withMessages([
                'domain' => ['Ten mien nay da co trong account hien tai.'],
            ]);
        }

        $accountName = $existingDomain->account?->name
            ?: ('#' . (string) $existingDomain->account_id);

        throw ValidationException::withMessages([
            'domain' => ["Ten mien nay dang thuoc account {$accountName}."],
        ]);
    }

    private function domainMatches(mixed $storedDomain, string $domain): bool
    {
        $storedHost = $this->normalizeDomainInput($storedDomain);

        return $storedHost !== ''
            && in_array($storedHost, $this->hostCandidates($domain), true);
    }

    private function hostCandidates(string $host): array
    {
        $host = $this->normalizeDomainInput($host);
        if ($host === '') {
            return [];
        }

        $candidates = [$host];
        $candidates[] = str_starts_with($host, 'www.')
            ? substr($host, 4)
            : 'www.' . $host;

        return array_values(array_unique(array_filter($candidates)));
    }

    private function normalizeDomainInput(mixed $value): string
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

        $host = trim(strtolower($host), " \t\n\r\0\x0B.");
        if ($host === '' || strlen($host) > 255) {
            return '';
        }

        return preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $host)
            ? $host
            : '';
    }
}
