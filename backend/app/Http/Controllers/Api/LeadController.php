<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadNote;
use App\Models\LeadStatus;
use App\Models\Product;
use App\Services\Leads\LeadBundleResolver;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class LeadController extends Controller
{
    public function __construct(
        protected LeadBundleResolver $bundleResolver
    ) {
    }

    protected function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    protected function applyLeadFilters(Builder $query, Request $request, bool $includeStatus = true): Builder
    {
        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function (Builder $builder) use ($search) {
                $builder->where('lead_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('address', 'like', "%{$search}%")
                    ->orWhere('product_summary', 'like', "%{$search}%")
                    ->orWhere('latest_note_excerpt', 'like', "%{$search}%")
                    ->orWhere('tag', 'like', "%{$search}%")
                    ->orWhere('link_url', 'like', "%{$search}%")
                    ->orWhereHas('order', fn (Builder $orderQuery) => $orderQuery->where('order_number', 'like', "%{$search}%"))
                    ->orWhereHas('notesTimeline', fn (Builder $noteQuery) => $noteQuery->where('content', 'like', "%{$search}%"))
                    ->orWhereHas('items', function (Builder $itemQuery) use ($search) {
                        $itemQuery->where('product_name', 'like', "%{$search}%")
                            ->orWhere('product_sku', 'like', "%{$search}%");
                    });
            });
        }

        if ($request->filled('tag')) {
            $query->where('tag', $request->input('tag'));
        }

        if ($request->filled('date_from')) {
            $query->where('placed_at', '>=', Carbon::parse($request->input('date_from')));
        }

        if ($request->filled('date_to')) {
            $query->where('placed_at', '<=', Carbon::parse($request->input('date_to')));
        }

        if ($includeStatus && $request->filled('status')) {
            $status = $request->input('status');
            $query->where(function (Builder $builder) use ($status) {
                if (is_numeric($status)) {
                    $builder->where('lead_status_id', (int) $status);
                    return;
                }

                $builder->where('status', $status)
                    ->orWhereHas('statusConfig', fn (Builder $statusQuery) => $statusQuery->where('code', $status));
            });
        }

        return $query;
    }

    protected function transformLead(Lead $lead): array
    {
        $status = $lead->statusConfig;
        $resolvedItems = $lead->items->map(function ($item) use ($lead) {
            $resolved = $this->bundleResolver->resolveStoredLeadItem($item, $lead);

            return [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $resolved['display_name'] ?: $item->product_name,
                'product_sku' => $item->product_sku,
                'product_slug' => $item->product_slug,
                'product_url' => $item->product_url,
                'quantity' => $item->quantity,
                'unit_price' => (float) $item->unit_price,
                'line_total' => (float) $item->line_total,
                'options' => $item->options,
                'bundle_items' => $resolved['bundle_children'],
                'bundle_option_title' => $resolved['bundle_option_title'],
                'bundle_subtotal' => (float) $resolved['bundle_subtotal'],
                'is_bundle' => (bool) $resolved['is_bundle'],
            ];
        })->values();

        $resolvedProductSummary = $resolvedItems
            ->map(function (array $item) {
                $name = trim((string) ($item['product_name'] ?? ''));
                $quantity = max(1, (int) ($item['quantity'] ?? 1));

                if ($name === '') {
                    return null;
                }

                return $quantity > 1 ? "{$name} x{$quantity}" : $name;
            })
            ->filter()
            ->implode(' | ');

        return [
            'id' => $lead->id,
            'lead_number' => $lead->lead_number,
            'customer_name' => $lead->customer_name,
            'phone' => $lead->phone,
            'email' => $lead->email,
            'address' => $lead->address,
            'product_summary' => $resolvedProductSummary ?: $lead->product_summary,
            'product_summary_short' => $resolvedProductSummary ?: $lead->product_summary_short,
            'product_name' => $lead->product_name,
            'tag' => $lead->tag,
            'link_url' => $lead->link_url,
            'status' => $lead->status,
            'placed_at' => optional($lead->placed_at)->toIso8601String(),
            'placed_date' => optional($lead->placed_at)->format('Y-m-d'),
            'placed_time' => optional($lead->placed_at)->format('H:i:s'),
            'total_amount' => (float) $lead->total_amount,
            'discount_amount' => (float) $lead->discount_amount,
            'message' => $lead->message,
            'latest_note_excerpt' => $lead->latest_note_excerpt,
            'last_noted_at' => optional($lead->last_noted_at)->toIso8601String(),
            'order_id' => $lead->order_id,
            'order_number' => $lead->order?->order_number,
            'status_config' => $status ? [
                'id' => $status->id,
                'code' => $status->code,
                'name' => $status->name,
                'color' => $status->color,
                'blocks_order_create' => (bool) $status->blocks_order_create,
            ] : null,
            'items' => $resolvedItems,
            'conversion_data' => $lead->conversion_data ?: [],
            'payload_snapshot' => $lead->payload_snapshot ?: [],
        ];
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);

        $query = Lead::query()
            ->with(['statusConfig', 'latestNote', 'items.product', 'order:id,order_number'])
            ->where('account_id', $accountId);

        $this->applyLeadFilters($query, $request);

        $sortBy = $request->input('sort_by', 'placed_at');
        $sortDirection = $request->input('sort_order', 'desc');
        if (!in_array($sortBy, ['placed_at', 'created_at', 'customer_name', 'total_amount'], true)) {
            $sortBy = 'placed_at';
        }
        $query->orderBy($sortBy, $sortDirection === 'asc' ? 'asc' : 'desc')->orderByDesc('id');

        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginator = $query->paginate($perPage);

        $summaryQuery = Lead::query()->where('account_id', $accountId);
        $this->applyLeadFilters($summaryQuery, $request, false);
        $summaryRows = $summaryQuery
            ->selectRaw('lead_status_id, count(*) as total')
            ->groupBy('lead_status_id')
            ->pluck('total', 'lead_status_id');

        $tags = Lead::query()
            ->where('account_id', $accountId)
            ->whereNotNull('tag')
            ->where('tag', '<>', '')
            ->distinct()
            ->orderBy('tag')
            ->pluck('tag')
            ->values();

        return response()->json([
            'data' => collect($paginator->items())->map(fn (Lead $lead) => $this->transformLead($lead))->values(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'latest_id' => Lead::query()->where('account_id', $accountId)->max('id') ?: 0,
            'statuses' => $statuses->map(fn ($status) => [
                'id' => $status->id,
                'code' => $status->code,
                'name' => $status->name,
                'color' => $status->color,
                'sort_order' => $status->sort_order,
                'is_default' => (bool) $status->is_default,
                'blocks_order_create' => (bool) $status->blocks_order_create,
                'count' => (int) ($summaryRows[$status->id] ?? 0),
            ])->values(),
            'tags' => $tags,
        ]);
    }

    public function show(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->with(['statusConfig', 'items.product', 'notesTimeline.user', 'order:id,order_number'])
            ->findOrFail($id);

        return response()->json($this->transformLead($lead) + [
            'notes_timeline' => $lead->notesTimeline->map(fn ($note) => [
                'id' => $note->id,
                'staff_name' => $note->staff_name,
                'content' => $note->content,
                'created_at' => $note->created_at?->toIso8601String(),
                'created_label' => $note->created_at?->format('Y-m-d H:i:s'),
            ])->values(),
        ]);
    }

    public function update(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->with('statusConfig')
            ->findOrFail($id);

        $validated = $request->validate([
            'lead_status_id' => 'nullable|integer|exists:lead_statuses,id',
            'status' => 'nullable|string|max:80',
            'tag' => 'nullable|string|max:120',
            'address' => 'nullable|string',
            'link_url' => 'nullable|string',
        ]);

        if (!empty($validated['lead_status_id'])) {
            $status = LeadStatus::query()->findOrFail((int) $validated['lead_status_id']);
            $lead->lead_status_id = $status->id;
            $lead->status = $status->code;
            $lead->status_changed_at = now();
        } elseif (!empty($validated['status'])) {
            $status = LeadStatus::query()->where('code', $validated['status'])->first();
            if ($status) {
                $lead->lead_status_id = $status->id;
                $lead->status = $status->code;
                $lead->status_changed_at = now();
            }
        }

        foreach (['tag', 'address', 'link_url'] as $field) {
            if (array_key_exists($field, $validated)) {
                $lead->{$field} = $validated[$field];
            }
        }

        $lead->save();
        $lead->load(['statusConfig', 'items.product', 'order:id,order_number']);

        return response()->json($this->transformLead($lead));
    }

    public function destroy(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->findOrFail($id);

        $lead->delete();

        return response()->json(['message' => 'Lead deleted successfully']);
    }

    public function notes(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->with(['notesTimeline.user'])
            ->findOrFail($id);

        return response()->json([
            'data' => $lead->notesTimeline->map(fn ($note) => [
                'id' => $note->id,
                'staff_name' => $note->staff_name,
                'content' => $note->content,
                'created_at' => $note->created_at?->toIso8601String(),
                'created_label' => $note->created_at?->format('Y-m-d H:i:s'),
            ])->values(),
        ]);
    }

    public function storeNote(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->findOrFail($id);

        $validated = $request->validate([
            'content' => 'required|string|max:5000',
        ]);

        $staffName = trim((string) (auth()->user()?->name ?? 'Nhân viên'));

        $note = LeadNote::create([
            'account_id' => $lead->account_id,
            'lead_id' => $lead->id,
            'user_id' => auth()->id(),
            'staff_name' => $staffName,
            'content' => $validated['content'],
        ]);

        $lead->forceFill([
            'latest_note_excerpt' => mb_strimwidth($validated['content'], 0, 180, '...'),
            'last_noted_at' => now(),
        ])->save();

        return response()->json([
            'id' => $note->id,
            'staff_name' => $note->staff_name,
            'content' => $note->content,
            'created_at' => $note->created_at?->toIso8601String(),
            'created_label' => $note->created_at?->format('Y-m-d H:i:s'),
            'latest_note_excerpt' => $lead->latest_note_excerpt,
        ], 201);
    }

    public function realtime(Request $request)
    {
        $accountId = $this->accountId($request);
        $afterId = max((int) $request->input('after_id', 0), 0);
        $latestKnownId = Lead::query()->where('account_id', $accountId)->max('id') ?: $afterId;

        $items = Lead::query()
            ->where('account_id', $accountId)
            ->where('id', '>', $afterId)
            ->with(['statusConfig', 'items.product', 'order:id,order_number'])
            ->orderBy('id')
            ->limit(20)
            ->get();

        $latestReturnedId = $items->last()?->id ?: $afterId;

        return response()->json([
            'latest_id' => $items->isNotEmpty() ? $latestReturnedId : $latestKnownId,
            'has_more' => $latestKnownId > $latestReturnedId,
            'items' => $items->map(fn (Lead $lead) => $this->transformLead($lead))->values(),
        ]);
    }

    public function orderDraft(Request $request, int $id)
    {
        $lead = Lead::query()
            ->where('account_id', $this->accountId($request))
            ->with(['items.product', 'statusConfig'])
            ->findOrFail($id);

        $payload = $lead->payload_snapshot ?: [];
        $conversionData = $lead->conversion_data ?: [];

        $items = collect($lead->items)
            ->flatMap(fn ($item) => $this->bundleResolver->expandLeadItemForOrderDraft($item, $lead))
            ->values();

        return response()->json([
            'lead_id' => $lead->id,
            'lead_number' => $lead->lead_number,
            'can_create_order' => !$lead->statusConfig?->blocks_order_create,
            'customer_name' => $lead->customer_name,
            'customer_phone' => $lead->phone,
            'customer_email' => $lead->email,
            'shipping_address' => $lead->address,
            'province' => $payload['province'] ?? null,
            'district' => $payload['district'] ?? null,
            'ward' => $payload['ward'] ?? null,
            'notes' => $lead->message,
            'discount' => (float) $lead->discount_amount,
            'shipping_fee' => (float) ($payload['shipping_fee'] ?? 0),
            'total_amount' => (float) $lead->total_amount,
            'source' => $conversionData['source'] ?? ($lead->tag ?: ($payload['source'] ?? 'Website')),
            'type' => $payload['type'] ?? 'Le',
            'shipment_status' => $payload['shipment_status'] ?? 'Chua giao',
            'status' => 'new',
            'items' => $items,
            'conversion_summary' => [
                'source' => $conversionData['source'] ?? $lead->tag ?? ($payload['source'] ?? 'Website'),
                'tag' => $lead->tag,
                'landing_url' => $conversionData['landing_url'] ?? null,
                'current_url' => $conversionData['current_url'] ?? null,
                'referrer' => $conversionData['referrer'] ?? null,
                'utm_source' => $conversionData['utm_source'] ?? null,
                'utm_medium' => $conversionData['utm_medium'] ?? null,
                'utm_campaign' => $conversionData['utm_campaign'] ?? null,
                'product_link' => $lead->link_url,
            ],
            'custom_attributes' => array_filter([
                'lead_number' => $lead->lead_number,
                'lead_tag' => $lead->tag,
                'source' => $conversionData['source'] ?? $lead->tag ?? ($payload['source'] ?? 'Website'),
                'landing_url' => $conversionData['landing_url'] ?? null,
                'current_url' => $conversionData['current_url'] ?? null,
                'referrer' => $conversionData['referrer'] ?? null,
                'utm_source' => $conversionData['utm_source'] ?? null,
                'utm_medium' => $conversionData['utm_medium'] ?? null,
                'utm_campaign' => $conversionData['utm_campaign'] ?? null,
                'product_link' => $lead->link_url,
            ], fn ($value) => !is_null($value) && $value !== ''),
        ]);
    }
}
