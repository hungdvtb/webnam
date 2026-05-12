<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteAnalyticsEvent;
use App\Services\Analytics\SiteAnalyticsService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SiteAnalyticsController extends Controller
{
    public function store(Request $request, SiteAnalyticsService $analyticsService)
    {
        $validated = $request->validate([
            'event_name' => ['required', 'string', Rule::in(SiteAnalyticsEvent::PUBLIC_EVENTS)],
            'site_code' => 'nullable|string|max:80',
            'visitor_id' => 'nullable|string|max:100',
            'session_id' => 'nullable|string|max:100',
            'product_id' => 'nullable|integer|min:1',
            'quantity' => 'nullable|integer|min:0|max:100000',
            'value' => 'nullable|numeric',
            'path' => 'nullable|string|max:2000',
            'url' => 'nullable|string|max:2000',
            'current_url' => 'nullable|string|max:2000',
            'referrer' => 'nullable|string|max:2000',
            'title' => 'nullable|string|max:255',
            'product_name' => 'nullable|string|max:255',
            'product_sku' => 'nullable|string|max:120',
            'product_slug' => 'nullable|string|max:255',
            'source' => 'nullable|string|max:80',
            'utm_source' => 'nullable|string|max:255',
            'utm_medium' => 'nullable|string|max:255',
            'utm_campaign' => 'nullable|string|max:255',
            'utm_content' => 'nullable|string|max:255',
            'utm_term' => 'nullable|string|max:255',
            'metadata' => 'nullable|array',
        ]);

        $analyticsService->recordFromRequest($request, $validated['event_name']);

        return response()->json(['success' => true]);
    }
}
