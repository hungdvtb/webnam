<?php

namespace App\Http\Middleware;

use Closure;
use App\Models\Account;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class IdentifyAccount
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $siteCode = $request->header('X-Account-Id'); // User explicitly said "mã để frontend dùng mã này để xác định account"
        
        // Let's support both X-Account-Id (which might be the site_code) and X-Site-Code
        $code = $request->header('X-Account-Id') ?: $request->header('X-Site-Code');
        
        if ($code && !is_numeric($code)) {
            // If it's a string like 'DAI_THANH', find the ID
            $account = Account::where('site_code', $code)->first();
            if ($account) {
                // Set it as the numeric ID for the rest of processing (Traits, etc.)
                $request->headers->set('X-Account-Id', $account->id);
            }
        }

        return $next($request);
    }
}
