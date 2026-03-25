<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadNote;
use App\Models\LeadNotificationRead;
use App\Models\LeadStatus;
use App\Models\Product;
use App\Models\SiteSetting;
use App\Services\Leads\LeadBundleResolver;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class LeadController extends Controller
{
    private const NOTIFICATION_SETTINGS_KEY_PREFIX = 'lead_notification_settings_user_';
    private const NOTIFICATION_ITEMS_LIMIT = 12;

    public function __construct(
        protected LeadBundleResolver $bundleResolver
    ) {
    }

    protected function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    protected function userId(Request $request): int
    {
        return (int) ($request->user()?->id ?? auth()->id() ?? 0);
    }

    protected function notificationSettingsKey(int $userId): string
    {
        return self::NOTIFICATION_SETTINGS_KEY_PREFIX . $userId;
    }

    protected function defaultNotificationSettings(): array
    {
        return [
            'enabled' => true,
            'use_default' => true,
            'custom_audio_path' => null,
            'custom_audio_name' => null,
        ];
    }

    protected function notificationSettings(int $accountId, int $userId): array
    {
        if ($accountId <= 0 || $userId <= 0) {
            return $this->formatNotificationSettings($this->defaultNotificationSettings());
        }

        $rawValue = SiteSetting::getValue($this->notificationSettingsKey($userId), $accountId);
        $decoded = [];

        if (is_string($rawValue) && trim($rawValue) !== '') {
            $parsed = json_decode($rawValue, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($parsed)) {
                $decoded = $parsed;
            }
        }

        return $this->formatNotificationSettings(array_merge($this->defaultNotificationSettings(), $decoded));
    }

    protected function formatNotificationSettings(array $settings): array
    {
        $audioPath = is_string($settings['custom_audio_path'] ?? null) && trim((string) $settings['custom_audio_path']) !== ''
            ? trim((string) $settings['custom_audio_path'])
            : null;

        return [
            'enabled' => ($settings['enabled'] ?? true) !== false,
            'use_default' => $audioPath ? (($settings['use_default'] ?? true) !== false) : true,
            'custom_audio_name' => is_string($settings['custom_audio_name'] ?? null) && trim((string) $settings['custom_audio_name']) !== ''
                ? trim((string) $settings['custom_audio_name'])
                : null,
            'custom_audio_path' => $audioPath,
            'custom_audio_url' => $audioPath ? asset('storage/' . ltrim($audioPath, '/')) : null,
            'has_custom_audio' => (bool) $audioPath,
        ];
    }

    protected function persistNotificationSettings(int $accountId, int $userId, array $settings): array
    {
        $payload = [
            'enabled' => ($settings['enabled'] ?? true) !== false,
            'use_default' => ($settings['use_default'] ?? true) !== false,
            'custom_audio_path' => $settings['custom_audio_path'] ?? null,
            'custom_audio_name' => $settings['custom_audio_name'] ?? null,
        ];

        SiteSetting::setValue(
            $this->notificationSettingsKey($userId),
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $accountId
        );

        return $this->formatNotificationSettings($payload);
    }

    protected function notificationReadMap(int $accountId, int $userId, array $leadIds): array
    {
        if ($accountId <= 0 || $userId <= 0 || empty($leadIds)) {
            return [];
        }

        return LeadNotificationRead::query()
            ->where('account_id', $accountId)
            ->where('user_id', $userId)
            ->whereIn('lead_id', $leadIds)
            ->get()
            ->keyBy('lead_id')
            ->all();
    }

    protected function unreadNotificationCount(int $accountId, int $userId): int
    {
        if ($accountId <= 0 || $userId <= 0) {
            return 0;
        }

        return Lead::query()
            ->where('account_id', $accountId)
            ->whereDoesntHave('notificationReads', function (Builder $builder) use ($userId) {
                $builder->where('user_id', $userId);
            })
            ->count();
    }

    protected function transformNotificationLead(Lead $lead, ?LeadNotificationRead $notificationRead = null): array
    {
        return $this->transformLead($lead) + [
            'notification_is_read' => (bool) $notificationRead,
            'notification_read_at' => $notificationRead?->read_at?->toIso8601String(),
        ];
    }

    protected function notificationCenterPayload(Request $request, int $limit = self::NOTIFICATION_ITEMS_LIMIT): array
    {
        $accountId = $this->accountId($request);
        $userId = $this->userId($request);
        $limit = max(1, min($limit, 30));

        $notifications = Lead::query()
            ->where('account_id', $accountId)
            ->with(['statusConfig', 'items.product', 'order:id,order_number'])
            ->orderByDesc('placed_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get();

        $leadIds = $notifications->pluck('id')->filter()->map(fn ($id) => (int) $id)->all();
        $readMap = $this->notificationReadMap($accountId, $userId, $leadIds);

        return [
            'items' => $notifications
                ->map(fn (Lead $lead) => $this->transformNotificationLead($lead, $readMap[$lead->id] ?? null))
                ->values(),
            'unread_count' => $this->unreadNotificationCount($accountId, $userId),
            'settings' => $this->notificationSettings($accountId, $userId),
        ];
    }

    protected function markNotificationsAsRead(Request $request, array $leadIds = [], bool $markAll = false): array
    {
        $accountId = $this->accountId($request);
        $userId = $this->userId($request);

        if ($accountId <= 0 || $userId <= 0) {
            return [];
        }

        $targetIds = $markAll
            ? Lead::query()
                ->where('account_id', $accountId)
                ->whereDoesntHave('notificationReads', function (Builder $builder) use ($userId) {
                    $builder->where('user_id', $userId);
                })
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all()
            : Lead::query()
                ->where('account_id', $accountId)
                ->whereIn('id', array_values(array_unique(array_map('intval', $leadIds))))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

        if (empty($targetIds)) {
            return [];
        }

        $timestamp = now();
        $rows = array_map(fn (int $leadId) => [
            'account_id' => $accountId,
            'lead_id' => $leadId,
            'user_id' => $userId,
            'read_at' => $timestamp,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ], $targetIds);

        LeadNotificationRead::query()->upsert(
            $rows,
            ['lead_id', 'user_id'],
            ['account_id', 'read_at', 'updated_at']
        );

        return $targetIds;
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
        $statusUpdated = array_key_exists('lead_status_id', $validated) || array_key_exists('status', $validated);

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

        if ($statusUpdated) {
            $this->markNotificationsAsRead($request, [$lead->id]);
        }

        $accountId = $this->accountId($request);
        $userId = $this->userId($request);
        $readMap = $this->notificationReadMap($accountId, $userId, [$lead->id]);

        return response()->json($this->transformNotificationLead($lead, $readMap[$lead->id] ?? null) + [
            'notification_unread_count' => $this->unreadNotificationCount($accountId, $userId),
        ]);
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

    public function notifications(Request $request)
    {
        return response()->json($this->notificationCenterPayload($request));
    }

    public function markNotificationsRead(Request $request)
    {
        $validated = $request->validate([
            'all' => 'nullable|boolean',
            'lead_ids' => 'nullable|array',
            'lead_ids.*' => 'integer',
        ]);

        $markedIds = $this->markNotificationsAsRead(
            $request,
            $validated['lead_ids'] ?? [],
            (bool) ($validated['all'] ?? false)
        );

        return response()->json([
            'marked_ids' => $markedIds,
            ...$this->notificationCenterPayload($request),
        ]);
    }

    public function storeNotificationSettings(Request $request)
    {
        $accountId = $this->accountId($request);
        $userId = $this->userId($request);

        $validated = $request->validate([
            'enabled' => 'nullable|boolean',
            'use_default' => 'nullable|boolean',
            'remove_custom_audio' => 'nullable|boolean',
            'audio' => 'nullable|file|mimes:mp3,wav,m4a,aac,ogg,webm|max:10240',
        ]);

        $settings = $this->notificationSettings($accountId, $userId);
        $audioPath = $settings['custom_audio_path'] ?? null;
        $audioName = $settings['custom_audio_name'] ?? null;

        if (!empty($validated['remove_custom_audio']) && $audioPath) {
            Storage::disk('public')->delete($audioPath);
            $audioPath = null;
            $audioName = null;
        }

        if ($request->hasFile('audio')) {
            if ($audioPath) {
                Storage::disk('public')->delete($audioPath);
            }

            $file = $request->file('audio');
            $extension = Str::lower($file->getClientOriginalExtension() ?: 'mp3');
            $filename = now()->format('YmdHis') . '_' . Str::random(10) . '.' . $extension;
            $audioPath = $file->storeAs("uploads/lead-notifications/{$accountId}/{$userId}", $filename, 'public');
            $audioName = $file->getClientOriginalName();
            $settings['use_default'] = false;
            $settings['enabled'] = true;
        }

        if (array_key_exists('enabled', $validated)) {
            $settings['enabled'] = (bool) $validated['enabled'];
        }

        if (array_key_exists('use_default', $validated)) {
            $settings['use_default'] = (bool) $validated['use_default'];
        }

        if (!$audioPath) {
            $settings['use_default'] = true;
        }

        $settings['custom_audio_path'] = $audioPath;
        $settings['custom_audio_name'] = $audioName;

        return response()->json([
            'settings' => $this->persistNotificationSettings($accountId, $userId, $settings),
        ]);
    }

    public function realtime(Request $request)
    {
        $accountId = $this->accountId($request);
        $userId = $this->userId($request);
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
        $readMap = $this->notificationReadMap(
            $accountId,
            $userId,
            $items->pluck('id')->filter()->map(fn ($id) => (int) $id)->all()
        );

        return response()->json([
            'latest_id' => $items->isNotEmpty() ? $latestReturnedId : $latestKnownId,
            'has_more' => $latestKnownId > $latestReturnedId,
            'unread_count' => $this->unreadNotificationCount($accountId, $userId),
            'items' => $items
                ->map(fn (Lead $lead) => $this->transformNotificationLead($lead, $readMap[$lead->id] ?? null))
                ->values(),
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
