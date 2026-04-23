<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attribute;
use App\Models\Carrier;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Customer;
use App\Models\InventoryDocument;
use App\Models\Invoice;
use App\Models\OrderStatus;
use App\Models\Product;
use App\Models\QuoteTemplate;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentStatusLog;
use App\Models\ShippingIntegration;
use App\Models\SiteSetting;
use App\Support\ImportCostRounding;
use App\Support\OrderBootstrapCache;
use App\Support\OrderStatusCatalog;
use App\Services\Inventory\InventoryService;
use App\Services\OrderInventorySlipService;
use App\Services\RepeatCustomerPhoneService;
use App\Services\Shipping\CarrierStatusMapper;
use App\Services\Shipping\ShipmentDispatchService;
use App\Services\Shipping\ShipmentRollbackService;
use App\Services\Shipping\ShippingAlertService;
use App\Services\Shipping\ShipmentStatusSyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    private const BOOTSTRAP_CACHE_TTL_SECONDS = 15;
    private const ORDER_NUMBER_SEQUENCE_START = 10000;
    private const ORDER_NUMBER_LOCK_WAIT_SECONDS = 10;
    private const ORDER_NUMBER_RETRY_ATTEMPTS = 5;
    private const SHIPPING_STATUS_SOURCE_MANUAL = 'manual';
    private const ORDER_KIND_OFFICIAL = Order::KIND_OFFICIAL;
    private const ORDER_KIND_TEMPLATE = Order::KIND_TEMPLATE;
    private const ORDER_KIND_DRAFT = Order::KIND_DRAFT;
    private const ORDER_TYPE_STANDARD = Order::TYPE_STANDARD;
    private const ORDER_TYPE_EXCHANGE_RETURN = Order::TYPE_EXCHANGE_RETURN;
    private const ORDER_TYPE_PARTIAL_DELIVERY = Order::TYPE_PARTIAL_DELIVERY;
    private const RETURN_STATUS_NOT_RETURNED = 'not_returned';
    private const RETURN_STATUS_RETURNED = 'returned';
    private const RETURN_STATUSES = [
        self::RETURN_STATUS_NOT_RETURNED,
        self::RETURN_STATUS_RETURNED,
    ];
    private const RETURN_FOLLOWUP_MIN_STALLED_DAYS = 10;
    private const RETURN_FOLLOWUP_FILTER_ALL = 'all';
    private const RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN = 'pending_return';
    private const RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN = self::ORDER_TYPE_EXCHANGE_RETURN;
    private const RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY = self::ORDER_TYPE_PARTIAL_DELIVERY;
    private const RETURN_FOLLOWUP_FILTERS = [
        self::RETURN_FOLLOWUP_FILTER_ALL,
        self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN,
        self::RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN,
        self::RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY,
    ];
    private const RETURN_FOLLOWUP_RESOLVED_STATUSES = [
        'pending_return',
        OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
        OrderStatusCatalog::PARTIAL_DELIVERY_CODE,
    ];
    private const ORDER_KIND_LABELS = [
        self::ORDER_KIND_OFFICIAL => 'Đơn hàng chính',
        self::ORDER_KIND_TEMPLATE => 'Đơn hàng mẫu',
        self::ORDER_KIND_DRAFT => 'Đơn nháp',
    ];
    private const ORDER_TYPE_LABELS = [
        self::ORDER_TYPE_STANDARD => 'ÄÆ¡n thÆ°á»ng',
        self::ORDER_TYPE_EXCHANGE_RETURN => 'ÄÆ¡n Ä‘á»•i tráº£',
        self::ORDER_TYPE_PARTIAL_DELIVERY => 'ÄÆ¡n giao hÃ ng 1 pháº§n',
    ];
    private const QUOTE_SETTING_KEYS = [
        'quote_logo_url',
        'quote_store_name',
        'quote_store_address',
        'quote_store_phone',
    ];
    private const ORDER_QUICK_PICK_SETTING_KEY = 'order_quick_pick_groups';
    private const QUICK_DISPATCH_MODE_MANUAL_SHIPMENT = 'manual_shipment';
    private const QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY = 'outside_delivery';
    private const QUICK_DISPATCH_MODES = [
        self::QUICK_DISPATCH_MODE_MANUAL_SHIPMENT,
        self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY,
    ];
    private const OUTSIDE_DELIVERY_CARRIER_CODE = 'outside_delivery';
    private const OUTSIDE_DELIVERY_TYPES = [
        'xe_om',
        'xe_khach',
        'tu_giao',
        'khac',
    ];
    private const OUTSIDE_DELIVERY_TYPE_LABELS = [
        'xe_om' => 'Xe ôm',
        'xe_khach' => 'Xe khách',
        'tu_giao' => 'Tự giao',
        'khac' => 'Khác',
    ];

    private const OUTSIDE_DELIVERY_TRACKING_PREFIX = 'shipngoai';
    private const OUTSIDE_DELIVERY_TRACKING_SEQUENCE_START = 100;
    private const QUICK_DISPATCH_EXPORT_NOTE_PREFIX = 'Tu tao tu van chuyen';
    private const QUICK_DISPATCH_EXPORT_META_SOURCE = 'quick_dispatch';

    public function __construct(
        protected RepeatCustomerPhoneService $repeatCustomerPhoneService,
        protected OrderInventorySlipService $orderInventorySlipService,
        protected ShipmentStatusSyncService $shipmentStatusSyncService,
    ) {
    }

    private function usesPostgresSearchDriver(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    private function loweredSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$column}))";
        }

        return "LOWER({$column})";
    }

    private function compactSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]', '', 'g'))";
        }

        $expression = $column;
        foreach (['-', '_', ' ', '/', '.', '#', ',', ';', ':', '(', ')'] as $character) {
            $expression = "REPLACE({$expression}, '{$character}', '')";
        }

        return "LOWER({$expression})";
    }

    private function normalizedWordsExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]+', ' ', 'g'))";
        }

        return "LOWER({$column})";
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private function normalizeSearchText(string $value): string
    {
        return (string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/\s+/u', ' ')
            ->trim();
    }

    private function compactSearchText(string $value): string
    {
        return (string) preg_replace('/[^a-z0-9]+/', '', $this->normalizeSearchText($value));
    }

    private function extractWordSearchTokens(string $value): array
    {
        return collect(preg_split('/\s+/u', $this->normalizeSearchText($value)) ?: [])
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function containsLike(string $value): ?string
    {
        $normalized = $this->normalizeSearchText($value);

        return $normalized === ''
            ? null
            : '%' . $this->escapeLike($normalized) . '%';
    }

    private function prefixLike(string $value): ?string
    {
        $normalized = $this->normalizeSearchText($value);

        return $normalized === ''
            ? null
            : $this->escapeLike($normalized) . '%';
    }

    private function applyInsensitiveLike($query, string $column, ?string $like, bool $or = false): void
    {
        if ($like === null) {
            return;
        }

        $expression = $this->loweredSearchExpression($column);
        $method = $or ? 'orWhereRaw' : 'whereRaw';
        $query->{$method}("{$expression} LIKE ? ESCAPE '\\'", [$like]);
    }

    private function orderNameSimilarityThreshold(string $normalizedTerm, int $tokenCount): float
    {
        $termLength = strlen($normalizedTerm);

        if ($termLength >= 18 || $tokenCount >= 3) {
            return 0.28;
        }

        if ($termLength >= 10 || $tokenCount === 2) {
            return 0.34;
        }

        if ($termLength >= 6) {
            return 0.42;
        }

        return 0.55;
    }

    private function candidateOrderNameAttributeIds(int $accountId): array
    {
        static $cache = [];

        if ($accountId <= 0) {
            return [];
        }

        if (array_key_exists($accountId, $cache)) {
            return $cache[$accountId];
        }

        $needleList = [
            'customer',
            'customer_name',
            'contact_name',
            'full name',
            'full_name',
            'fullname',
            'ho ten',
            'ho_ten',
            'ho va ten',
            'ho_va_ten',
            'nguoi nhan',
            'nguoi_nhan',
            'nguoi nhan hang',
            'nguoi_nhan_hang',
            'nguoi mua',
            'nguoi_mua',
            'ten nguoi mua',
            'ten_nguoi_mua',
            'receiver',
            'receiver_name',
            'recipient',
            'recipient_name',
            'buyer',
            'buyer_name',
            'billing_name',
            'shipping_full_name',
            'shipping_name',
            'ten khach',
            'ten khach hang',
            'ten nguoi nhan',
        ];

        $cache[$accountId] = Attribute::query()
            ->where('account_id', $accountId)
            ->where('entity_type', 'order')
            ->get(['id', 'code', 'name'])
            ->filter(function (Attribute $attribute) use ($needleList) {
                $haystack = $this->normalizeSearchText(
                    trim((string) ($attribute->code ?? '') . ' ' . (string) ($attribute->name ?? ''))
                );

                return $haystack !== '' && Str::contains($haystack, $needleList);
            })
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        return $cache[$accountId];
    }

    private function candidateOrderPhoneAttributeIds(int $accountId): array
    {
        static $cache = [];

        if ($accountId <= 0) {
            return [];
        }

        if (array_key_exists($accountId, $cache)) {
            return $cache[$accountId];
        }

        $needleList = [
            'phone',
            'phone_number',
            'customer_phone',
            'contact_phone',
            'receiver_phone',
            'recipient_phone',
            'shipping_phone',
            'buyer_phone',
            'billing_phone',
            'mobile',
            'mobile_phone',
            'telephone',
            'tel',
            'dien thoai',
            'so dien thoai',
            'so_dien_thoai',
            'so dt',
            'so_dt',
            'sdt',
            'zalo',
        ];

        $cache[$accountId] = Attribute::query()
            ->where('account_id', $accountId)
            ->where('entity_type', 'order')
            ->get(['id', 'code', 'name'])
            ->filter(function (Attribute $attribute) use ($needleList) {
                $haystack = $this->normalizeSearchText(
                    trim((string) ($attribute->code ?? '') . ' ' . (string) ($attribute->name ?? ''))
                );

                return $haystack !== '' && Str::contains($haystack, $needleList);
            })
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        return $cache[$accountId];
    }

    private function applyOrderNameFieldConstraint($query, string $column, string $term): void
    {
        $normalizedTerm = $this->normalizeSearchText($term);
        if ($normalizedTerm === '') {
            return;
        }

        $wordExpr = $this->normalizedWordsExpression($column);
        $compactExpr = $this->compactSearchExpression($column);
        $phraseLike = '%' . $this->escapeLike($normalizedTerm) . '%';
        $compactTerm = $this->compactSearchText($term);
        $compactLike = $compactTerm !== '' ? '%' . $this->escapeLike($compactTerm) . '%' : null;
        $tokenLikes = collect($this->extractWordSearchTokens($term))
            ->map(fn (string $token) => '%' . $this->escapeLike($token) . '%')
            ->values()
            ->all();
        $similarityThreshold = $this->orderNameSimilarityThreshold($normalizedTerm, count($tokenLikes));

        $query->where(function ($fieldQuery) use (
            $wordExpr,
            $compactExpr,
            $normalizedTerm,
            $phraseLike,
            $compactTerm,
            $compactLike,
            $tokenLikes,
            $similarityThreshold
        ) {
            $fieldQuery->whereRaw("{$wordExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);

            if ($compactLike !== null) {
                $fieldQuery->orWhereRaw("{$compactExpr} LIKE ? ESCAPE '\\'", [$compactLike]);
            }

            if (!empty($tokenLikes)) {
                $fieldQuery->orWhere(function ($tokenQuery) use ($wordExpr, $tokenLikes) {
                    foreach ($tokenLikes as $tokenLike) {
                        $tokenQuery->whereRaw("{$wordExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                    }
                });
            }

            if ($this->usesPostgresSearchDriver() && strlen($normalizedTerm) >= 4) {
                $fieldQuery->orWhereRaw(
                    "GREATEST(similarity({$wordExpr}, ?), word_similarity({$wordExpr}, ?)) >= ?",
                    [$normalizedTerm, $normalizedTerm, $similarityThreshold]
                );

                if ($compactTerm !== '' && strlen($compactTerm) >= 4) {
                    $fieldQuery->orWhereRaw(
                        "similarity({$compactExpr}, ?) >= ?",
                        [$compactTerm, min(0.72, $similarityThreshold + 0.08)]
                    );
                }
            }
        });
    }

    private function applyOrderNameSearch($query, string $term, int $accountId, bool $or = false): void
    {
        if ($this->normalizeSearchText($term) === '') {
            return;
        }

        $nameAttributeIds = $this->candidateOrderNameAttributeIds($accountId);
        $method = $or ? 'orWhere' : 'where';

        $query->{$method}(function ($nameQuery) use ($term, $nameAttributeIds) {
            $this->applyOrderNameFieldConstraint($nameQuery, 'customer_name', $term);

            $nameQuery->orWhereHas('shipments', function ($shipmentQuery) use ($term) {
                $this->applyOrderNameFieldConstraint($shipmentQuery, 'customer_name', $term);
            });

            if (!empty($nameAttributeIds)) {
                $nameQuery->orWhereHas('attributeValues', function ($attributeValueQuery) use ($term, $nameAttributeIds) {
                    $attributeValueQuery->whereIn('attribute_id', $nameAttributeIds);
                    $this->applyOrderNameFieldConstraint($attributeValueQuery, 'value', $term);
                });
            }
        });
    }

    private function applyOrderPhoneSearch(
        $query,
        string $term,
        int $accountId,
        bool $or = false,
        bool $prefixOnly = false
    ): void {
        $like = $prefixOnly
            ? $this->prefixLike($term)
            : $this->containsLike($term);

        if ($like === null) {
            return;
        }

        $phoneAttributeIds = $this->candidateOrderPhoneAttributeIds($accountId);
        $method = $or ? 'orWhere' : 'where';

        $query->{$method}(function ($phoneQuery) use ($like, $phoneAttributeIds) {
            $this->applyInsensitiveLike($phoneQuery, 'customer_phone', $like);

            $phoneQuery->orWhereHas('shipments', function ($shipmentQuery) use ($like) {
                $this->applyInsensitiveLike($shipmentQuery, 'customer_phone', $like);
            });

            if (!empty($phoneAttributeIds)) {
                $phoneQuery->orWhereHas('attributeValues', function ($attributeValueQuery) use ($phoneAttributeIds, $like) {
                    $attributeValueQuery->whereIn('attribute_id', $phoneAttributeIds);
                    $this->applyInsensitiveLike($attributeValueQuery, 'value', $like);
                });
            }
        });
    }

    private function extractSearchTerms(Request $request): array
    {
        $rawSearchTerms = $request->input('search_terms');
        $sources = [];

        if (is_array($rawSearchTerms)) {
            $sources = $rawSearchTerms;
        } elseif (is_string($rawSearchTerms) && trim($rawSearchTerms) !== '') {
            $sources[] = $rawSearchTerms;
        }

        if (empty($sources) && $request->filled('search')) {
            $sources[] = (string) $request->input('search');
        }

        return collect($sources)
            ->flatMap(function ($value) {
                return preg_split('/[,\n;\t]+/u', (string) $value) ?: [];
            })
            ->map(function ($value) {
                $collapsed = preg_replace('/\s+/u', ' ', (string) $value);
                return $this->normalizeSearchText((string) $collapsed);
            })
            ->filter()
            ->unique()
            ->take(20)
            ->values()
            ->all();
    }

    private function applyOrderSearchTerm($query, string $term, int $accountId): void
    {
        $containsLike = $this->containsLike($term);

        if ($containsLike === null) {
            return;
        }

        $this->applyInsensitiveLike($query, 'order_number', $containsLike);
        $this->applyOrderNameSearch($query, $term, $accountId, true);
        $this->applyOrderPhoneSearch($query, $term, $accountId, true);
        $this->applyInsensitiveLike($query, 'shipping_address', $containsLike, true);
        $this->applyInsensitiveLike($query, 'notes', $containsLike, true);
        $this->applyInsensitiveLike($query, 'shipping_tracking_code', $containsLike, true);
        $this->applyInsensitiveLike($query, 'return_tracking_code', $containsLike, true);

        $query
            ->orWhereHas('items', function ($itemQuery) use ($containsLike) {
                $this->applyInsensitiveLike($itemQuery, 'product_sku_snapshot', $containsLike);
                $this->applyInsensitiveLike($itemQuery, 'product_name_snapshot', $containsLike, true);
            })
            ->orWhereHas('items.product', function ($productQuery) use ($containsLike) {
                $this->applyInsensitiveLike($productQuery, 'sku', $containsLike);
                $this->applyInsensitiveLike($productQuery, 'name', $containsLike, true);
            })
            ->orWhereHas('shipments', function ($shipmentQuery) use ($containsLike) {
                $this->applyInsensitiveLike($shipmentQuery, 'customer_name', $containsLike);
                $this->applyInsensitiveLike($shipmentQuery, 'shipment_number', $containsLike);
                $this->applyInsensitiveLike($shipmentQuery, 'tracking_number', $containsLike, true);
                $this->applyInsensitiveLike($shipmentQuery, 'carrier_tracking_code', $containsLike, true);
                $this->applyInsensitiveLike($shipmentQuery, 'external_order_number', $containsLike, true);
            });
    }

    private function resolveOrderDisplayCustomerName(Order $order, array $nameAttributeIds = []): string
    {
        $customerName = trim((string) ($order->customer_name ?? ''));
        if ($customerName !== '') {
            return $customerName;
        }

        $shipmentCustomerName = trim((string) ($order->activeShipment?->customer_name ?? ''));
        if ($shipmentCustomerName !== '') {
            return $shipmentCustomerName;
        }

        if (!empty($nameAttributeIds) && $order->relationLoaded('attributeValues')) {
            foreach ($order->attributeValues as $attributeValue) {
                if (
                    in_array((int) ($attributeValue->attribute_id ?? 0), $nameAttributeIds, true)
                    && trim((string) ($attributeValue->value ?? '')) !== ''
                ) {
                    return trim((string) $attributeValue->value);
                }
            }
        }

        return '';
    }

    private function resolveOrderDisplayCustomerPhone(Order $order, array $phoneAttributeIds = []): string
    {
        $customerPhone = trim((string) ($order->customer_phone ?? ''));
        if ($customerPhone !== '') {
            return $customerPhone;
        }

        $shipmentCustomerPhone = trim((string) ($order->activeShipment?->customer_phone ?? ''));
        if ($shipmentCustomerPhone !== '') {
            return $shipmentCustomerPhone;
        }

        if (!empty($phoneAttributeIds) && $order->relationLoaded('attributeValues')) {
            foreach ($order->attributeValues as $attributeValue) {
                if (
                    in_array((int) ($attributeValue->attribute_id ?? 0), $phoneAttributeIds, true)
                    && trim((string) ($attributeValue->value ?? '')) !== ''
                ) {
                    return trim((string) $attributeValue->value);
                }
            }
        }

        return '';
    }

    private function freshShippingState(): array
    {
        $state = [
            'internal_shipping_fee' => 0,
            'shipping_status' => null,
            'shipping_synced_at' => null,
            'shipping_status_source' => self::SHIPPING_STATUS_SOURCE_MANUAL,
            'shipping_carrier_code' => null,
            'shipping_carrier_name' => null,
            'shipping_tracking_code' => null,
            'shipping_dispatched_at' => null,
            'shipping_issue_code' => null,
            'shipping_issue_message' => null,
            'shipping_issue_detected_at' => null,
        ];

        if ($this->orderTableHasColumn('external_delivery_meta')) {
            $state['external_delivery_meta'] = null;
        }

        return $state;
    }

    private function resolveOrderInternalShippingFee(Order $order): float
    {
        $storedShippingFee = $this->orderTableHasColumn('internal_shipping_fee')
            ? max(0, round((float) ($order->internal_shipping_fee ?? 0), 2))
            : 0.0;

        $outsideDeliveryFee = 0.0;
        if ($this->orderTableHasColumn('external_delivery_meta') && is_array($order->external_delivery_meta)) {
            $outsideDeliveryFee = max(0, round((float) data_get($order->external_delivery_meta, 'shipping_cost', 0), 2));
        }

        $activeShipmentFee = 0.0;
        if ($order->relationLoaded('activeShipment') && $order->activeShipment) {
            $activeShipmentFee = max(0, round((float) ($order->activeShipment->shipping_cost ?? 0), 2));
        }

        return max($storedShippingFee, $outsideDeliveryFee, $activeShipmentFee);
    }

    private function attachResolvedInternalShippingFee(Order $order): void
    {
        $order->setAttribute('internal_shipping_fee', $this->resolveOrderInternalShippingFee($order));
    }

    private function orderDetailRelations(): array
    {
        $relations = [
            'user:id,name',
            'activeShipment:id,order_id,shipment_number,carrier_name,tracking_number,carrier_tracking_code,shipment_status,shipping_cost,shipped_at,out_for_delivery_at',
            'items' => fn ($query) => $query
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'actual_product_id',
                    'product_name_snapshot',
                    'actual_product_name_snapshot',
                    'product_sku_snapshot',
                    'actual_product_sku_snapshot',
                    'sort_order',
                    'quantity',
                    'price',
                    'cost_price',
                    'cost_total',
                    'profit_total',
                    'options',
                ])
                ->orderBy('sort_order')
                ->orderBy('id')
                ->with([
                    'product' => fn ($productQuery) => $productQuery
                        ->select(['id', 'name', 'sku', 'cost_price', 'expected_cost', 'inventory_unit_id'])
                        ->with([
                            'unit:id,name',
                            'parentConfigurable' => fn ($parentQuery) => $parentQuery
                                ->select(['products.id', 'products.name', 'products.inventory_unit_id'])
                                ->with(['unit:id,name']),
                        ]),
                    'actualProduct' => fn ($productQuery) => $productQuery
                        ->select(['id', 'name', 'sku', 'cost_price', 'expected_cost', 'inventory_unit_id'])
                        ->with([
                            'unit:id,name',
                            'parentConfigurable' => fn ($parentQuery) => $parentQuery
                                ->select(['products.id', 'products.name', 'products.inventory_unit_id'])
                                ->with(['unit:id,name']),
                        ]),
                ]),
            'attributeValues' => fn ($query) => $query
                ->select(['id', 'order_id', 'attribute_id', 'value'])
                ->with([
                    'attribute:id,code,name',
                ]),
        ];

        if (!$this->orderSupplementItemsTableExists()) {
            return $relations;
        }

        $relations['supplementItems'] = fn ($query) => $query
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'product_name_snapshot',
                    'product_sku_snapshot',
                    'quantity',
                    'price',
                    'cost_price',
                    'total_price',
                    'total_cost',
                    'notes',
                ])
                ->with([
                    'product' => fn ($productQuery) => $productQuery
                        ->select(['id', 'name', 'sku', 'cost_price', 'expected_cost', 'inventory_unit_id'])
                        ->with([
                            'unit:id,name',
                            'parentConfigurable' => fn ($parentQuery) => $parentQuery
                                ->select(['products.id', 'products.name', 'products.inventory_unit_id'])
                                ->with(['unit:id,name']),
                        ]),
                ]);

        return $relations;
    }

    private function orderPrintRelations(): array
    {
        return [
            'items' => fn ($query) => $query
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'actual_product_id',
                    'product_name_snapshot',
                    'actual_product_name_snapshot',
                    'product_sku_snapshot',
                    'actual_product_sku_snapshot',
                    'sort_order',
                    'quantity',
                    'price',
                ])
                ->orderBy('sort_order')
                ->orderBy('id')
                ->with([
                    'product:id,name,sku',
                    'actualProduct:id,name,sku',
                ]),
        ];
    }

    private function resolveCurrentProductCost(?Product $product, mixed $fallback = null): float
    {
        return ImportCostRounding::roundUnitCost($product?->cost_price ?? $product?->expected_cost ?? $fallback ?? 0);
    }

    private function appendCurrentCostMetrics(Order $order): Order
    {
        if (!$order->relationLoaded('items')) {
            return $order;
        }

        $itemRevenue = 0;
        $currentCostTotal = 0;

        $order->items->each(function (OrderItem $item) use (&$itemRevenue, &$currentCostTotal) {
            $quantity = (int) ($item->quantity ?? 0);
            $unitPrice = round((float) ($item->price ?? 0), 2);
            $orderedCurrentCostPrice = $this->resolveCurrentProductCost($item->product, $item->cost_price);
            $currentCostPrice = $this->resolveCurrentProductCost($item->actualProduct ?: $item->product, $item->cost_price);
            $currentCostLineTotal = ImportCostRounding::lineTotal($currentCostPrice, $quantity);

            $item->setAttribute('ordered_current_cost_price', $orderedCurrentCostPrice);
            $item->setAttribute('current_cost_price', $currentCostPrice);
            $item->setAttribute('current_cost_total', $currentCostLineTotal);
            $item->setAttribute('current_profit_total', round(($unitPrice * $quantity) - $currentCostLineTotal, 2));

            $itemRevenue += $unitPrice * $quantity;
            $currentCostTotal += $currentCostLineTotal;
        });

        $finalTotal = round(
            $itemRevenue - (float) ($order->discount ?? 0),
            2
        );

        $order->setAttribute('current_cost_total', round($currentCostTotal, 2));
        $order->setAttribute('current_profit_total', round($finalTotal - $currentCostTotal, 2));

        return $order;
    }

    private function mutationResponsePayload(Order $order): array
    {
        $order->refresh();
        $order->loadMissing([
            'activeShipment:id,order_id,shipping_cost',
        ]);

        return $this->appendOrderTimePayload([
            'id' => (int) $order->id,
            'order_number' => $order->order_number,
            'order_kind' => $this->normalizeOrderKind((string) $order->order_kind),
            'order_type' => $this->normalizeOrderType((string) $order->order_type),
            'status' => $order->status,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'notes' => $order->notes,
            'total_price' => (float) $order->total_price,
            'cost_total' => (float) ($order->cost_total ?? 0),
            'shipping_fee' => (float) ($order->shipping_fee ?? 0),
            'internal_shipping_fee' => $this->resolveOrderInternalShippingFee($order),
            'discount' => (float) ($order->discount ?? 0),
            'settlement_delta' => (float) ($order->settlement_delta ?? 0),
            'return_tracking_code' => $order->return_tracking_code,
            'return_status' => $this->normalizeReturnStatus($order->return_status),
            'supplement_items_total_price' => (float) ($order->supplement_items_total_price ?? 0),
            'supplement_items_cost_total' => (float) ($order->supplement_items_cost_total ?? 0),
            'report_revenue_total' => (float) ($order->report_revenue_total ?? 0),
            'report_cost_total' => (float) ($order->report_cost_total ?? 0),
            'report_profit_total' => (float) ($order->report_profit_total ?? 0),
            'print_count' => (int) ($order->print_count ?? 0),
            'last_printed_at' => $order->last_printed_at?->toISOString(),
            'shipping_status_source' => $order->shipping_status_source ?: self::SHIPPING_STATUS_SOURCE_MANUAL,
            'converted_from_order_id' => $order->converted_from_order_id,
            'converted_from_kind' => $order->converted_from_kind,
            'created_at' => $order->created_at?->toISOString(),
            'updated_at' => $order->updated_at?->toISOString(),
        ], $order);
    }

    private function appendOrderTimePayload(array $payload, Order $order): array
    {
        return array_merge($payload, [
            'draft_created_at' => $this->resolveOrderDraftCreatedAt($order)?->toISOString(),
            'officialized_at' => $this->resolveOrderOfficializedAt($order)?->toISOString(),
            'displayed_at' => $this->resolveOrderDisplayedAt($order)?->toISOString(),
        ]);
    }

    private function normalizeOrderTimestamp(mixed $value): ?Carbon
    {
        if ($value instanceof Carbon) {
            return $value;
        }

        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance($value);
        }

        if (blank($value)) {
            return null;
        }

        return Carbon::parse($value);
    }

    private function resolveOrderDraftCreatedAt(Order $order): ?Carbon
    {
        $draftCreatedAt = $this->normalizeOrderTimestamp($order->draft_created_at ?? null);

        if ($draftCreatedAt) {
            return $draftCreatedAt;
        }

        return $this->normalizeOrderKind((string) $order->order_kind) === self::ORDER_KIND_DRAFT
            ? $this->normalizeOrderTimestamp($order->created_at)
            : null;
    }

    private function resolveOrderOfficializedAt(Order $order): ?Carbon
    {
        $officializedAt = $this->normalizeOrderTimestamp($order->officialized_at ?? null);

        if ($officializedAt) {
            return $officializedAt;
        }

        return $this->normalizeOrderKind((string) $order->order_kind) === self::ORDER_KIND_OFFICIAL
            ? $this->normalizeOrderTimestamp($order->created_at)
            : null;
    }

    private function resolveOrderDisplayedAt(Order $order): ?Carbon
    {
        return match ($this->normalizeOrderKind((string) $order->order_kind)) {
            self::ORDER_KIND_DRAFT => $this->resolveOrderDraftCreatedAt($order) ?: $this->normalizeOrderTimestamp($order->created_at),
            self::ORDER_KIND_OFFICIAL => $this->resolveOrderOfficializedAt($order) ?: $this->normalizeOrderTimestamp($order->created_at),
            default => $this->normalizeOrderTimestamp($order->created_at),
        };
    }

    private function normalizeOrderKind(?string $orderKind): string
    {
        $normalized = Str::lower(trim((string) $orderKind));

        return in_array($normalized, Order::KINDS, true)
            ? $normalized
            : self::ORDER_KIND_OFFICIAL;
    }

    private function normalizeOrderType(?string $orderType): string
    {
        $normalized = Str::lower(trim((string) $orderType));

        return in_array($normalized, Order::TYPES, true)
            ? $normalized
            : self::ORDER_TYPE_STANDARD;
    }

    private function extractRequestedOrderTypes(mixed $orderTypes): Collection
    {
        $rawValues = is_array($orderTypes)
            ? $orderTypes
            : [$orderTypes];

        return collect($rawValues)
            ->flatMap(function ($value) {
                if (is_array($value)) {
                    $value = $value['value'] ?? $value['id'] ?? null;
                } elseif (is_object($value)) {
                    $value = $value->value ?? $value->id ?? null;
                }

                return explode(',', (string) $value);
            })
            ->map(fn ($value) => Str::lower(trim((string) $value)))
            ->filter(fn (string $value) => in_array($value, Order::TYPES, true))
            ->unique()
            ->values();
    }

    private function extractRequestedStatusCodes(mixed $statuses): Collection
    {
        $rawValues = is_array($statuses)
            ? $statuses
            : [$statuses];

        return collect($rawValues)
            ->flatMap(function ($value) {
                if (is_array($value)) {
                    $value = $value['value'] ?? $value['id'] ?? null;
                } elseif (is_object($value)) {
                    $value = $value->value ?? $value->id ?? null;
                }

                return explode(',', (string) $value);
            })
            ->map(fn ($value) => Str::lower(trim((string) $value)))
            ->filter()
            ->unique()
            ->values();
    }

    private function normalizeReturnTrackingCode(mixed $trackingCode): ?string
    {
        $normalized = trim((string) $trackingCode);

        return $normalized !== ''
            ? $normalized
            : null;
    }

    private function normalizeReturnStatus(?string $returnStatus): string
    {
        $normalized = Str::lower(trim((string) $returnStatus));

        return in_array($normalized, self::RETURN_STATUSES, true)
            ? $normalized
            : self::RETURN_STATUS_NOT_RETURNED;
    }

    private function orderTableHasColumn(string $column): bool
    {
        static $columnCache = [];

        if (!array_key_exists($column, $columnCache)) {
            $columnCache[$column] = Schema::hasColumn('orders', $column);
        }

        return $columnCache[$column];
    }

    private function orderSupplementItemsTableExists(): bool
    {
        static $tableExists = null;

        if ($tableExists === null) {
            $tableExists = Schema::hasTable('order_supplement_items');
        }

        return $tableExists;
    }

    private function orderStatusLogsTableExists(): bool
    {
        static $tableExists = null;

        if ($tableExists === null) {
            $tableExists = Schema::hasTable('order_status_logs');
        }

        return $tableExists;
    }

    private function normalizeReturnFollowupFilter(?string $value): string
    {
        $normalized = Str::lower(trim((string) $value));

        return in_array($normalized, self::RETURN_FOLLOWUP_FILTERS, true)
            ? $normalized
            : self::RETURN_FOLLOWUP_FILTER_ALL;
    }

    private function applyManagedOrderScope($query, string $table = 'orders'): void
    {
        $query->where(function ($managedOrderQuery) use ($table) {
            $managedOrderQuery
                ->where("{$table}.order_kind", self::ORDER_KIND_OFFICIAL)
                ->orWhereNull("{$table}.order_kind")
                ->orWhere("{$table}.order_kind", '');
        });
    }

    private function buildReturnFollowupBaseQuery(int $accountId)
    {
        $query = DB::table('orders')
            ->where('orders.account_id', $accountId);

        if ($this->orderTableHasColumn('deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $this->applyManagedOrderScope($query, 'orders');

        return $query;
    }

    private function buildPendingReturnFollowupQuery(int $accountId, Carbon $threshold)
    {
        $query = $this->buildReturnFollowupBaseQuery($accountId);
        $referenceCandidates = [];

        if ($this->orderStatusLogsTableExists()) {
            $pendingReturnLogSubquery = DB::table('order_status_logs')
                ->select('order_id', DB::raw('MAX(created_at) as relevant_date'))
                ->where('to_status', 'pending_return')
                ->groupBy('order_id');

            $query->leftJoinSub($pendingReturnLogSubquery, 'pending_return_logs', function ($join) {
                $join->on('pending_return_logs.order_id', '=', 'orders.id');
            });

            $referenceCandidates[] = 'pending_return_logs.relevant_date';
        }

        if ($this->orderTableHasColumn('shipping_issue_detected_at')) {
            $referenceCandidates[] = 'orders.shipping_issue_detected_at';
        }

        if ($this->orderTableHasColumn('shipping_dispatched_at')) {
            $referenceCandidates[] = 'orders.shipping_dispatched_at';
        }

        if (empty($referenceCandidates)) {
            $referenceCandidates[] = 'orders.created_at';
        }

        $referenceExpression = 'COALESCE(' . implode(', ', $referenceCandidates) . ')';

        return $query
            ->where('orders.status', 'pending_return')
            ->whereRaw("{$referenceExpression} IS NOT NULL")
            ->whereRaw("{$referenceExpression} <= ?", [$threshold->toDateTimeString()])
            ->select('orders.id as order_id')
            ->selectRaw('? as followup_category', [self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN])
            ->selectRaw("{$referenceExpression} as relevant_date");
    }

    private function buildExchangeReturnFollowupQuery(int $accountId, Carbon $threshold)
    {
        $query = $this->buildReturnFollowupBaseQuery($accountId)
            ->where('orders.order_type', self::ORDER_TYPE_EXCHANGE_RETURN)
            ->whereNotIn('orders.status', self::RETURN_FOLLOWUP_RESOLVED_STATUSES);

        if ($this->orderSupplementItemsTableExists()) {
            $query->whereExists(function ($supplementQuery) {
                $supplementQuery->select(DB::raw(1))
                    ->from('order_supplement_items')
                    ->whereColumn('order_supplement_items.order_id', 'orders.id')
                    ->where('order_supplement_items.quantity', '>', 0);
            });
        } elseif ($this->orderTableHasColumn('supplement_items_total_price')) {
            $query->where('orders.supplement_items_total_price', '>', 0);
        } else {
            $query->whereRaw('1 = 0');
        }

        if (!$this->orderTableHasColumn('shipping_dispatched_at')) {
            return $query->whereRaw('1 = 0')
                ->select('orders.id as order_id')
                ->selectRaw('? as followup_category', [self::RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN])
                ->selectRaw('orders.created_at as relevant_date');
        }

        return $query
            ->whereNotNull('orders.shipping_dispatched_at')
            ->where('orders.shipping_dispatched_at', '<=', $threshold->toDateTimeString())
            ->select('orders.id as order_id')
            ->selectRaw('? as followup_category', [self::RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN])
            ->selectRaw('orders.shipping_dispatched_at as relevant_date');
    }

    private function buildPartialDeliveryFollowupQuery(int $accountId, Carbon $threshold)
    {
        $query = $this->buildReturnFollowupBaseQuery($accountId)
            ->where('orders.order_type', self::ORDER_TYPE_PARTIAL_DELIVERY)
            ->whereNotIn('orders.status', self::RETURN_FOLLOWUP_RESOLVED_STATUSES);

        if (!$this->orderTableHasColumn('shipping_dispatched_at')) {
            return $query->whereRaw('1 = 0')
                ->select('orders.id as order_id')
                ->selectRaw('? as followup_category', [self::RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY])
                ->selectRaw('orders.created_at as relevant_date');
        }

        return $query
            ->whereNotNull('orders.shipping_dispatched_at')
            ->where('orders.shipping_dispatched_at', '<=', $threshold->toDateTimeString())
            ->select('orders.id as order_id')
            ->selectRaw('? as followup_category', [self::RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY])
            ->selectRaw('orders.shipping_dispatched_at as relevant_date');
    }

    private function buildReturnFollowupSearchOrderIdsQuery(int $accountId, array $terms)
    {
        $query = Order::query()
            ->select('orders.id')
            ->distinct()
            ->where('orders.account_id', $accountId);

        if ($this->orderTableHasColumn('deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $this->applyManagedOrderScope($query, 'orders');

        foreach ($terms as $term) {
            $query->where(function ($searchQuery) use ($term, $accountId) {
                $this->applyOrderSearchTerm($searchQuery, $term, $accountId);
            });
        }

        return $query;
    }

    private function applyReturnFollowupSearch($query, int $accountId, array $terms): void
    {
        if (empty($terms)) {
            return;
        }

        $query->whereIn(
            'orders.id',
            $this->buildReturnFollowupSearchOrderIdsQuery($accountId, $terms)
        );
    }

    private function countReturnFollowupQuery($query): int
    {
        return (int) DB::query()
            ->fromSub($query, 'return_followup_count')
            ->count();
    }

    private function orderDisplayTimestampSql(string $table = 'orders'): string
    {
        $createdAtSql = "{$table}.created_at";

        if (!$this->orderTableHasColumn('order_kind')) {
            return $createdAtSql;
        }

        $kindSql = "COALESCE({$table}.order_kind, '" . self::ORDER_KIND_OFFICIAL . "')";
        $draftTimestampSql = $this->orderTableHasColumn('draft_created_at')
            ? "COALESCE({$table}.draft_created_at, {$createdAtSql})"
            : $createdAtSql;
        $officialTimestampSql = $this->orderTableHasColumn('officialized_at')
            ? "COALESCE({$table}.officialized_at, {$createdAtSql})"
            : $createdAtSql;

        return "CASE
            WHEN {$kindSql} = '" . self::ORDER_KIND_DRAFT . "' THEN {$draftTimestampSql}
            WHEN {$kindSql} = '" . self::ORDER_KIND_OFFICIAL . "' THEN {$officialTimestampSql}
            ELSE {$createdAtSql}
        END";
    }

    private function orderDisplayTimestampSelect(string $table = 'orders', string $alias = 'displayed_at')
    {
        return DB::raw($this->orderDisplayTimestampSql($table) . " as {$alias}");
    }

    private function applyOrderDisplayDateFilter($query, string $operator, string $date, string $table = 'orders'): void
    {
        $query->whereRaw(
            'DATE(' . $this->orderDisplayTimestampSql($table) . ") {$operator} ?",
            [$date]
        );
    }

    private function filterPersistableOrderData(array $data): array
    {
        return collect($data)
            ->filter(fn ($value, $column) => $this->orderTableHasColumn((string) $column))
            ->all();
    }

    private function selectExistingOrderColumns(array $columns): array
    {
        return array_values(array_filter(
            $columns,
            fn ($column) => $this->orderTableHasColumn((string) $column)
        ));
    }

    private function ensureRequestedOrderSchemaSupport(
        string $orderKind,
        string $orderType,
        bool $hasSupplementItems = false
    ): void {
        if ($orderKind !== self::ORDER_KIND_OFFICIAL && !$this->orderTableHasColumn('order_kind')) {
            throw ValidationException::withMessages([
                'order_kind' => 'Môi trường hiện tại chưa hỗ trợ đơn nháp hoặc đơn mẫu. Cần chạy migration đồng bộ trước khi lưu.',
            ]);
        }

        if ($orderType === self::ORDER_TYPE_STANDARD) {
            return;
        }

        $requiredColumns = [
            'order_type',
            'settlement_delta',
            'return_tracking_code',
            'return_status',
            'supplement_items_total_price',
            'supplement_items_cost_total',
            'report_revenue_total',
            'report_cost_total',
            'report_profit_total',
        ];

        $missingColumns = array_filter(
            $requiredColumns,
            fn (string $column) => !$this->orderTableHasColumn($column)
        );

        if (!empty($missingColumns)) {
            throw ValidationException::withMessages([
                'order_type' => 'Môi trường hiện tại chưa hỗ trợ đơn đổi trả hoặc giao một phần. Cần chạy migration đồng bộ trước khi lưu.',
            ]);
        }

        if ($hasSupplementItems && !$this->orderSupplementItemsTableExists()) {
            throw ValidationException::withMessages([
                'supplement_items' => 'Môi trường hiện tại chưa hỗ trợ lưu sản phẩm bổ sung. Cần chạy migration đồng bộ trước khi lưu.',
            ]);
        }
    }

    private function supplementReturnTrackingPayload(
        ?string $orderType,
        mixed $returnTrackingCode = null,
        ?string $returnStatus = null
    ): array {
        $normalizedOrderType = $this->normalizeOrderType($orderType);

        if ($normalizedOrderType === self::ORDER_TYPE_STANDARD) {
            return [
                'return_tracking_code' => null,
                'return_status' => self::RETURN_STATUS_NOT_RETURNED,
            ];
        }

        return [
            'return_tracking_code' => $this->normalizeReturnTrackingCode($returnTrackingCode),
            'return_status' => $this->normalizeReturnStatus($returnStatus),
        ];
    }

    private function initialOrderKindTimestampPayload(string $orderKind, ?Carbon $timestamp = null): array
    {
        $timestamp ??= now();
        $orderKind = $this->normalizeOrderKind($orderKind);
        $payload = [];

        if ($orderKind === self::ORDER_KIND_DRAFT && $this->orderTableHasColumn('draft_created_at')) {
            $payload['draft_created_at'] = $timestamp;
        }

        if ($orderKind === self::ORDER_KIND_OFFICIAL && $this->orderTableHasColumn('officialized_at')) {
            $payload['officialized_at'] = $timestamp;
        }

        return $payload;
    }

    private function convertedOrderKindTimestampPayload(Order $order, string $targetKind, ?Carbon $timestamp = null): array
    {
        $timestamp ??= now();
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);
        $targetKind = $this->normalizeOrderKind($targetKind);
        $payload = [];

        if ($targetKind === self::ORDER_KIND_DRAFT && $this->orderTableHasColumn('draft_created_at')) {
            $payload['draft_created_at'] = $timestamp;
        }

        if ($targetKind === self::ORDER_KIND_OFFICIAL) {
            if ($this->orderTableHasColumn('officialized_at')) {
                $payload['officialized_at'] = $timestamp;
            }

            if (
                $currentKind === self::ORDER_KIND_DRAFT
                && $this->orderTableHasColumn('draft_created_at')
                && !$this->normalizeOrderTimestamp($order->draft_created_at ?? null)
            ) {
                $payload['draft_created_at'] = $this->normalizeOrderTimestamp($order->created_at) ?: $timestamp;
            }
        }

        return $payload;
    }

    private function shouldManageInventory(string $orderKind): bool
    {
        return $this->normalizeOrderKind($orderKind) === self::ORDER_KIND_OFFICIAL;
    }

    private function requiresOfficialValidation(string $orderKind): bool
    {
        return $this->normalizeOrderKind($orderKind) === self::ORDER_KIND_OFFICIAL;
    }

    private function orderNumberPrefix(string $orderKind): string
    {
        return match ($this->normalizeOrderKind($orderKind)) {
            self::ORDER_KIND_TEMPLATE => 'TM',
            self::ORDER_KIND_DRAFT => 'DR',
            default => 'OR',
        };
    }

    private function withNamedLock(string $lockName, callable $callback)
    {
        $connection = DB::connection();
        $driver = $connection->getDriverName();

        if ($driver === 'mysql') {
            $row = $connection->selectOne('SELECT GET_LOCK(?, ?) AS acquired', [
                $lockName,
                self::ORDER_NUMBER_LOCK_WAIT_SECONDS,
            ]);

            if ((int) ($row->acquired ?? 0) !== 1) {
                throw new \RuntimeException('Không thể khóa bộ sinh mã đơn hàng.');
            }

            try {
                return $callback();
            } finally {
                $connection->select('SELECT RELEASE_LOCK(?)', [$lockName]);
            }
        }

        if ($driver === 'pgsql') {
            $lockKey = abs((int) crc32($lockName));
            $connection->statement('SELECT pg_advisory_lock(?)', [$lockKey]);

            try {
                return $callback();
            } finally {
                $connection->statement('SELECT pg_advisory_unlock(?)', [$lockKey]);
            }
        }

        return $callback();
    }

    private function withOrderNumberLock(string $orderKind, callable $callback)
    {
        return $this->withNamedLock(
            'orders:order-number:' . $this->orderNumberPrefix($orderKind),
            $callback
        );
    }

    private function isOrderNumberUniqueViolation(QueryException $exception): bool
    {
        $message = Str::lower($exception->getMessage());

        if (!Str::contains($message, ['order_number', 'orders.order_number', 'orders_order_number_unique'])) {
            return false;
        }

        return $this->isUniqueConstraintViolation($exception);
    }

    private function isUniqueConstraintViolation(QueryException $exception): bool
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $message = Str::lower($exception->getMessage());

        return in_array($sqlState, ['23000', '23505', '19'], true)
            || Str::contains($message, ['duplicate', 'unique', 'constraint']);
    }

    private function runOrderNumberMutation(string $orderKind, callable $callback)
    {
        $normalizedKind = $this->normalizeOrderKind($orderKind);

        for ($attempt = 1; $attempt <= self::ORDER_NUMBER_RETRY_ATTEMPTS; $attempt++) {
            try {
                return $this->withOrderNumberLock($normalizedKind, $callback);
            } catch (QueryException $exception) {
                if ($attempt === self::ORDER_NUMBER_RETRY_ATTEMPTS || !$this->isOrderNumberUniqueViolation($exception)) {
                    throw $exception;
                }

                usleep($attempt * 50000);
            }
        }

        throw new \RuntimeException('Không thể sinh mã đơn hàng duy nhất.');
    }

    private function generateOrderNumber(?string $orderKind = null, ?int $ignoreOrderId = null): string
    {
        $orderKind = $this->normalizeOrderKind($orderKind);
        $prefix = $this->orderNumberPrefix($orderKind);

        $orderNumberQuery = Order::withoutGlobalScope('account_id')->withTrashed();

        $latestOrderNumber = (clone $orderNumberQuery)
            ->where('order_number', 'LIKE', $prefix . '%A0')
            ->orderByRaw('LENGTH(order_number) DESC')
            ->orderBy('order_number', 'desc')
            ->value('order_number');

        $nextNumber = self::ORDER_NUMBER_SEQUENCE_START;
        if (is_string($latestOrderNumber) && preg_match('/^' . preg_quote($prefix, '/') . '(\d+)A0$/', $latestOrderNumber, $matches)) {
            $nextNumber = max(self::ORDER_NUMBER_SEQUENCE_START, ((int) $matches[1]) + 1);
        }

        while (true) {
            $candidate = "{$prefix}{$nextNumber}A0";
            $existsQuery = (clone $orderNumberQuery)->where('order_number', $candidate);

            if ($ignoreOrderId) {
                $existsQuery->where('id', '!=', $ignoreOrderId);
            }

            if (!$existsQuery->exists()) {
                return $candidate;
            }

            $nextNumber++;
        }
    }

    private function defaultStatusForKind(int $accountId, string $orderKind, ?string $currentStatus = null): string
    {
        if ($this->normalizeOrderKind($orderKind) !== self::ORDER_KIND_OFFICIAL) {
            return $currentStatus ?: 'new';
        }

        return OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('is_default', true)
            ->value('code') ?: ($currentStatus ?: 'new');
    }

    private function validateOfficialOrderPayload(array $payload, string $regionType = 'new'): void
    {
        $shippingAddress = trim((string) ($payload['shipping_address'] ?? ''));

        if ($shippingAddress === '') {
            throw ValidationException::withMessages([
                'shipping_address' => 'Đơn chính thức phải có địa chỉ giao hàng.',
            ]);
        }
    }

    private function normalizePersistedOrderTextFields(array $payload): array
    {
        foreach (['customer_name', 'customer_email', 'customer_phone', 'shipping_address'] as $field) {
            if (array_key_exists($field, $payload)) {
                $payload[$field] = trim((string) ($payload[$field] ?? ''));
            }
        }

        if (array_key_exists('customer_email', $payload) && $payload['customer_email'] === '') {
            $payload['customer_email'] = null;
        }

        return $payload;
    }

    private function validateDraftOrderPayload(array $payload): void
    {
        $customerName = trim((string) ($payload['customer_name'] ?? ''));
        $customerPhone = trim((string) ($payload['customer_phone'] ?? ''));

        if ($customerName === '' && $customerPhone === '') {
            throw ValidationException::withMessages([
                'customer_name' => 'Đơn nháp phải có tên khách hàng hoặc số điện thoại.',
            ]);
        }
    }

    private function allowsEmptyItems(string $orderKind): bool
    {
        return $this->normalizeOrderKind($orderKind) === self::ORDER_KIND_DRAFT;
    }

    private function validateOfficialOrderItems(iterable $items): void
    {
        if (collect($items)->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Đơn chính thức phải có ít nhất 1 sản phẩm.',
            ]);
        }
    }

    private function collectRequestItems(Request $request, bool $allowEmptyItems = false): array
    {
        if ($request->has('items')) {
            return $this->normalizeOrderedOrderItems($request->input('items', []))->all();
        }

        if ($allowEmptyItems) {
            return [];
        }

        $cart = Cart::with('items.product')->where('user_id', Auth::id())->first();
        if (!$cart || !isset($cart->items) || $cart->items->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Đơn hàng chưa có sản phẩm.',
            ]);
        }

        return $cart->items->values()->map(function ($item, int $index) {
            $product = $item->product;

            return [
                'product_id' => $item->product_id,
                'sort_order' => $index + 1,
                'quantity' => $item->quantity,
                'price' => $product ? ($product->current_price ?? $item->price) : $item->price,
                'cost_price' => ImportCostRounding::roundUnitCost($product?->cost_price ?? $product?->expected_cost ?? 0),
                'options' => $item->options ?? null,
            ];
        })->all();
    }

    private function normalizeOrderedOrderItems(iterable $rawItems): Collection
    {
        return collect($rawItems)
            ->map(fn ($item) => is_array($item) ? $item : [])
            ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']))
            ->values()
            ->map(function (array $item, int $index) {
                $item['sort_order'] = $index + 1;

                return $item;
            });
    }

    private function syncManualOrderItems(Order $order, array $rawItems, bool $allowEmptyItems = false): array
    {
        $normalizedItems = $this->normalizeOrderedOrderItems($rawItems);

        if ($normalizedItems->isEmpty()) {
            if ($allowEmptyItems) {
                return [
                    'items' => [],
                    'total_price' => 0,
                    'cost_total' => 0,
                    'profit_total' => 0,
                ];
            }
            throw ValidationException::withMessages([
                'items' => 'Đơn hàng phải có ít nhất 1 sản phẩm.',
            ]);
        }

        $productIds = $normalizedItems->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
        $actualProductIds = $normalizedItems->pluck('actual_product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $requestedProductIds = array_values(array_unique(array_merge($productIds, $actualProductIds)));

        $products = Product::query()
            ->whereIn('id', $requestedProductIds)
            ->get()
            ->keyBy('id');

        if (count($requestedProductIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'items' => 'Có sản phẩm không tồn tại hoặc không thuộc cửa hàng hiện tại.',
            ]);
        }

        $createdItems = [];

        foreach ($normalizedItems as $item) {
            /** @var Product $product */
            $product = $products->get((int) $item['product_id']);
            /** @var Product|null $actualProduct */
            $actualProduct = null;
            $actualProductId = (int) ($item['actual_product_id'] ?? 0);
            if ($actualProductId > 0) {
                $actualProduct = $products->get($actualProductId);
            }
            $quantity = (int) $item['quantity'];
            $price = round((float) ($item['price'] ?? $product->price ?? 0), 2);
            $costPrice = $actualProduct
                ? ImportCostRounding::roundUnitCost($actualProduct->cost_price ?? $actualProduct->expected_cost ?? $item['cost_price'] ?? 0)
                : ImportCostRounding::roundUnitCost($item['cost_price'] ?? $product->cost_price ?? $product->expected_cost ?? 0);
            $costTotal = ImportCostRounding::lineTotal($costPrice, $quantity);
            $profitTotal = round(($price * $quantity) - $costTotal, 2);

            $createdItems[] = $order->items()->create([
                'account_id' => $order->account_id,
                'product_id' => $product->id,
                'actual_product_id' => $actualProduct?->id,
                'product_name_snapshot' => $item['name'] ?? $product->name,
                'actual_product_name_snapshot' => $actualProduct
                    ? ($item['actual_name'] ?? $item['actual_product_name_snapshot'] ?? $actualProduct->name)
                    : null,
                'product_sku_snapshot' => $item['sku'] ?? $product->sku,
                'actual_product_sku_snapshot' => $actualProduct
                    ? ($item['actual_sku'] ?? $item['actual_product_sku_snapshot'] ?? $actualProduct->sku)
                    : null,
                'sort_order' => (int) $item['sort_order'],
                'quantity' => $quantity,
                'price' => $price,
                'cost_price' => $costPrice,
                'cost_total' => $costTotal,
                'profit_total' => $profitTotal,
                'options' => $item['options'] ?? null,
            ]);
        }

        return [
            'items' => $createdItems,
            'total_price' => round(collect($createdItems)->sum(fn ($row) => (float) $row->price * (int) $row->quantity), 2),
            'cost_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->cost_total), 2),
            'profit_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->profit_total), 2),
        ];
    }

    private function syncOrderItems(Order $order, array $rawItems, string $orderKind, bool $preferSubmittedCostPrice = false): array
    {
        if ($this->shouldManageInventory($orderKind)) {
            return app(InventoryService::class)->attachInventoryToOrder($order, $rawItems, $preferSubmittedCostPrice);
        }

        return $this->syncManualOrderItems($order, $rawItems, $this->allowsEmptyItems($orderKind));
    }

    private function releaseInventoryIfNeeded(Order $order): void
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return;
        }

        app(InventoryService::class)->releaseOrderInventory($order);
    }

    private function reserveInventoryIfNeeded(Order $order): array
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return [
                'items' => $order->items,
                'total_price' => round((float) $order->items()->sum(DB::raw('price * quantity')), 2),
                'cost_total' => round((float) $order->items()->sum('cost_total'), 2),
                'profit_total' => round((float) $order->items()->sum('profit_total'), 2),
            ];
        }

        return app(InventoryService::class)->reserveOrderInventory($order->fresh(['items']));
    }

    private function syncOrderAttributes(Order $order, array $customAttributes = []): void
    {
        $customAttributes = collect($customAttributes)
            ->mapWithKeys(function ($value, $attrCode) {
                $normalizedCode = trim((string) $attrCode);

                return $normalizedCode === ''
                    ? []
                    : [$normalizedCode => $value];
            })
            ->all();

        if (empty($customAttributes)) {
            return;
        }

        $attrCodes = array_keys($customAttributes);
        // Some deployments still keep attributes.code globally unique, so reuse
        // existing codes even when they originated from another entity type.
        $existingAttrs = Attribute::withoutGlobalScope('account_id')
            ->whereIn('code', $attrCodes)
            ->get()
            ->keyBy('code');

        foreach ($customAttributes as $attrCode => $value) {
            $attribute = $existingAttrs->get($attrCode);

            if (!$attribute) {
                $attributePayload = [
                    'account_id' => $order->account_id,
                    'entity_type' => 'order',
                    'code' => $attrCode,
                    'name' => ucwords(str_replace('_', ' ', $attrCode)),
                    'frontend_type' => 'text',
                    'status' => true,
                ];

                if (\App\Models\Attribute::hasSortOrderColumn()) {
                    $attributePayload['sort_order'] = \App\Models\Attribute::nextSortOrderFor('order', $order->account_id);
                }

                try {
                    $attribute = Attribute::create($attributePayload);
                } catch (QueryException $exception) {
                    if (!$this->isUniqueConstraintViolation($exception)) {
                        throw $exception;
                    }

                    $attribute = Attribute::withoutGlobalScope('account_id')
                        ->where('code', $attrCode)
                        ->first();

                    if (!$attribute) {
                        throw $exception;
                    }
                }

                $existingAttrs->put($attrCode, $attribute);
            }

            \App\Models\OrderAttributeValue::updateOrCreate(
                [
                    'order_id' => $order->id,
                    'attribute_id' => $attribute->id,
                ],
                [
                    'value' => is_array($value) ? json_encode($value) : $value,
                ]
            );
        }
    }

    private function syncSupplementItems(Order $order, array $rawItems): array
    {
        $normalizedItems = collect($rawItems)
            ->map(fn ($item) => is_array($item) ? $item : [])
            ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']))
            ->values();

        if (!$this->orderSupplementItemsTableExists()) {
            if ($normalizedItems->isNotEmpty()) {
                throw ValidationException::withMessages([
                    'supplement_items' => 'Môi trường hiện tại chưa hỗ trợ lưu sản phẩm bổ sung. Cần chạy migration đồng bộ trước khi lưu.',
                ]);
            }

            return [
                'items' => [],
                'total_price' => 0,
                'cost_total' => 0,
            ];
        }

        $order->supplementItems()->delete();

        if ($normalizedItems->isEmpty()) {
            return [
                'items' => [],
                'total_price' => 0,
                'cost_total' => 0,
            ];
        }

        $productIds = $normalizedItems->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->get()
            ->keyBy('id');

        if (count($productIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'supplement_items' => 'CÃ³ sáº£n pháº©m khai bÃ¡o bá»• sung khÃ´ng tá»“n táº¡i hoáº·c khÃ´ng thuá»™c cá»­a hÃ ng hiá»‡n táº¡i.',
            ]);
        }

        $createdItems = [];

        foreach ($normalizedItems as $item) {
            /** @var Product $product */
            $product = $products->get((int) $item['product_id']);
            $quantity = (int) ($item['quantity'] ?? 0);
            $price = round((float) ($item['price'] ?? $product->current_price ?? $product->price ?? 0), 2);
            $costPrice = ImportCostRounding::roundUnitCost($item['cost_price'] ?? $product->cost_price ?? $product->expected_cost ?? 0);
            $totalPrice = round($price * $quantity, 2);
            $totalCost = ImportCostRounding::lineTotal($costPrice, $quantity);

            $createdItems[] = $order->supplementItems()->create([
                'account_id' => $order->account_id,
                'product_id' => $product->id,
                'product_name_snapshot' => $item['name'] ?? $product->name,
                'product_sku_snapshot' => $item['sku'] ?? $product->sku,
                'quantity' => $quantity,
                'price' => $price,
                'cost_price' => $costPrice,
                'total_price' => $totalPrice,
                'total_cost' => $totalCost,
                'notes' => $item['notes'] ?? null,
            ]);
        }

        return [
            'items' => $createdItems,
            'total_price' => round(collect($createdItems)->sum(fn ($row) => (float) $row->total_price), 2),
            'cost_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->total_cost), 2),
        ];
    }

    private function resolveStoredImportCostFromOrderLine($costPrice, $costTotal, int $quantity): float
    {
        if ($costPrice !== null && $costPrice !== '') {
            return ImportCostRounding::roundUnitCost((float) $costPrice);
        }

        if ($quantity > 0 && $costTotal !== null && $costTotal !== '') {
            return ImportCostRounding::roundUnitCost((float) $costTotal / $quantity);
        }

        return 0;
    }

    private function resolveCurrentImportCostFromProduct(?Product $product, float $fallback = 0): float
    {
        if ($product) {
            if ($product->cost_price !== null) {
                return ImportCostRounding::roundUnitCost((float) $product->cost_price);
            }

            if ($product->expected_cost !== null) {
                return ImportCostRounding::roundUnitCost((float) $product->expected_cost);
            }
        }

        return ImportCostRounding::roundUnitCost($fallback);
    }

    private function expandRefreshImportCostProductIds(array $productIds): array
    {
        $normalizedProductIds = collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedProductIds)) {
            return [];
        }

        $variationIds = Product::query()
            ->whereIn('id', $normalizedProductIds)
            ->with(['variations' => fn ($query) => $query->select('products.id')])
            ->get(['products.id'])
            ->flatMap(fn (Product $product) => $product->variations->pluck('id'))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        return collect($normalizedProductIds)
            ->merge($variationIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function matchesRefreshImportCostProductFilter($productId, $actualProductId = null, ?array $productIdLookup = null): bool
    {
        if ($productIdLookup === null) {
            return true;
        }

        $resolvedProductId = (int) $productId;
        if ($resolvedProductId > 0 && isset($productIdLookup[$resolvedProductId])) {
            return true;
        }

        $resolvedActualProductId = (int) $actualProductId;
        return $resolvedActualProductId > 0 && isset($productIdLookup[$resolvedActualProductId]);
    }

    private function refreshOrderImportCostSnapshots(Order $order, array $productIds = []): array
    {
        $order->loadMissing(['items.product', 'items.actualProduct']);

        if ($this->orderSupplementItemsTableExists()) {
            $order->loadMissing(['supplementItems.product']);
        }

        $productIdLookup = !empty($productIds)
            ? array_fill_keys(
                collect($productIds)
                    ->map(fn ($id) => (int) $id)
                    ->filter()
                    ->unique()
                    ->values()
                    ->all(),
                true
            )
            : null;

        $itemRevenue = 0.0;
        $costTotal = 0.0;
        $updatedItems = 0;

        foreach ($order->items as $item) {
            $quantity = (int) ($item->quantity ?? 0);
            $lineRevenue = round((float) ($item->price ?? 0) * $quantity, 2);
            $fallbackCostPrice = $this->resolveStoredImportCostFromOrderLine(
                $item->cost_price,
                $item->cost_total,
                $quantity
            );
            $storedLineCost = $item->cost_total !== null && $item->cost_total !== ''
                ? round((float) $item->cost_total, 2)
                : ImportCostRounding::lineTotal($fallbackCostPrice, $quantity);

            if ($this->matchesRefreshImportCostProductFilter($item->product_id, $item->actual_product_id, $productIdLookup)) {
                $costPrice = $this->resolveCurrentImportCostFromProduct(
                    $item->actualProduct ?: $item->product,
                    $fallbackCostPrice
                );
                $lineCost = ImportCostRounding::lineTotal($costPrice, $quantity);
                $lineProfit = round($lineRevenue - $lineCost, 2);

                $item->forceFill([
                    'cost_price' => $costPrice,
                    'cost_total' => $lineCost,
                    'profit_total' => $lineProfit,
                ])->save();

                $updatedItems++;
            } else {
                $lineCost = $storedLineCost;
            }

            $itemRevenue += $lineRevenue;
            $costTotal += $lineCost;
        }

        $supplementTotalPrice = 0.0;
        $supplementCostTotal = 0.0;
        $updatedSupplementItems = 0;

        if ($this->orderSupplementItemsTableExists()) {
            foreach ($order->supplementItems as $item) {
                $quantity = (int) ($item->quantity ?? 0);
                $linePrice = $item->total_price !== null && $item->total_price !== ''
                    ? round((float) $item->total_price, 2)
                    : round((float) ($item->price ?? 0) * $quantity, 2);
                $fallbackCostPrice = $this->resolveStoredImportCostFromOrderLine(
                    $item->cost_price,
                    $item->total_cost,
                    $quantity
                );
                $storedLineCost = $item->total_cost !== null && $item->total_cost !== ''
                    ? round((float) $item->total_cost, 2)
                    : ImportCostRounding::lineTotal($fallbackCostPrice, $quantity);

                if ($this->matchesRefreshImportCostProductFilter($item->product_id, null, $productIdLookup)) {
                    $costPrice = $this->resolveCurrentImportCostFromProduct($item->product, $fallbackCostPrice);
                    $lineCost = ImportCostRounding::lineTotal($costPrice, $quantity);

                    $item->forceFill([
                        'cost_price' => $costPrice,
                        'total_price' => $linePrice,
                        'total_cost' => $lineCost,
                    ])->save();

                    $updatedSupplementItems++;
                } else {
                    $lineCost = $storedLineCost;
                }

                $supplementTotalPrice += $linePrice;
                $supplementCostTotal += $lineCost;
            }
        }

        $this->recalculateOrderTotals(
            $order,
            round($itemRevenue, 2),
            round($costTotal, 2),
            (string) $order->order_type,
            (float) ($order->settlement_delta ?? 0),
            round($supplementTotalPrice, 2),
            round($supplementCostTotal, 2)
        );

        return [
            'updated_items' => $updatedItems,
            'updated_supplement_items' => $updatedSupplementItems,
        ];
    }

    private function recalculateOrderTotals(
        Order $order,
        float $itemRevenue,
        float $costTotal,
        ?string $orderType = null,
        ?float $settlementDelta = null,
        ?float $supplementTotalPrice = null,
        ?float $supplementCostTotal = null
    ): void
    {
        $normalizedOrderType = $this->normalizeOrderType($orderType ?? (string) $order->order_type);
        $finalTotal = round(
            $itemRevenue - (float) ($order->discount ?? 0),
            2
        );

        $baseCostTotal = round($costTotal, 2);
        $baseProfitTotal = round($finalTotal - $baseCostTotal, 2);
        $effectiveSettlementDelta = $normalizedOrderType === self::ORDER_TYPE_STANDARD
            ? 0
            : round((float) ($settlementDelta ?? $order->settlement_delta ?? 0), 2);
        $effectiveSupplementTotalPrice = $normalizedOrderType === self::ORDER_TYPE_STANDARD
            ? 0
            : round((float) ($supplementTotalPrice ?? $order->supplement_items_total_price ?? 0), 2);
        $effectiveSupplementCostTotal = $normalizedOrderType === self::ORDER_TYPE_STANDARD
            ? 0
            : round((float) ($supplementCostTotal ?? $order->supplement_items_cost_total ?? 0), 2);
        $reportRevenueTotal = $normalizedOrderType === self::ORDER_TYPE_STANDARD
            ? $finalTotal
            : round($finalTotal - $effectiveSupplementTotalPrice + $effectiveSettlementDelta, 2);
        $reportCostTotal = $normalizedOrderType === self::ORDER_TYPE_STANDARD
            ? $baseCostTotal
            : round($baseCostTotal - $effectiveSupplementCostTotal, 2);
        $reportProfitTotal = round($reportRevenueTotal - $reportCostTotal, 2);

        $order->forceFill($this->filterPersistableOrderData([
            'order_type' => $normalizedOrderType,
            'total_price' => $finalTotal,
            'settlement_delta' => $effectiveSettlementDelta,
            'cost_total' => $baseCostTotal,
            'profit_total' => $baseProfitTotal,
            'supplement_items_total_price' => $effectiveSupplementTotalPrice,
            'supplement_items_cost_total' => $effectiveSupplementCostTotal,
            'report_revenue_total' => $reportRevenueTotal,
            'report_cost_total' => $reportCostTotal,
            'report_profit_total' => $reportProfitTotal,
        ]))->save();
    }

    private function syncActiveShipmentFinancials(Order $order): void
    {
        $this->shipmentStatusSyncService->syncShipmentFinancialsFromOrder($order);
    }

    private function syncOfficialCustomerAndInvoice(Order $order, bool $syncCustomerStats = true): void
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return;
        }

        $phone = trim((string) $order->customer_phone);
        $customer = null;

        if ($phone !== '') {
            $customer = Customer::firstOrCreate(
                ['account_id' => $order->account_id, 'phone' => $phone],
                [
                    'name' => $order->customer_name,
                    'email' => $order->customer_email,
                    'address' => $order->shipping_address,
                ]
            );

            $customer->forceFill([
                'name' => $order->customer_name ?: $customer->name,
                'email' => $order->customer_email ?: $customer->email,
                'address' => $order->shipping_address ?: $customer->address,
            ])->save();
        }

        if ($customer && (int) $order->customer_id !== (int) $customer->id) {
            $order->forceFill(['customer_id' => $customer->id])->save();
        }

        if ($customer && $syncCustomerStats) {
            $customer->increment('total_orders');
            $customer->increment('total_spent', (float) $order->total_price);
        }

        Invoice::updateOrCreate(
            ['order_id' => $order->id],
            [
                'invoice_number' => Invoice::query()->where('order_id', $order->id)->value('invoice_number') ?: 'INV-' . strtoupper(Str::random(10)),
                'amount' => $order->total_price,
                'status' => 'pending',
                'due_date' => now()->addDays(3),
            ]
        );
    }

    private function removeOfficialSideEffects(Order $order): void
    {
        Invoice::query()->where('order_id', $order->id)->delete();
        $order->forceFill(['customer_id' => null])->save();
    }

    private function guardConvertOrderKind(Order $order, string $targetKind): void
    {
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);
        $targetKind = $this->normalizeOrderKind($targetKind);

        if ($currentKind === $targetKind) {
            throw ValidationException::withMessages([
                'order_kind' => 'Đơn hàng đã ở đúng nhóm được chọn.',
            ]);
        }

        if ($targetKind !== self::ORDER_KIND_OFFICIAL && $order->shipments()->exists()) {
            throw ValidationException::withMessages([
                'order_kind' => 'Không thể chuyển đơn đã có vận đơn sang nhóm khác.',
            ]);
        }

        if ($targetKind !== self::ORDER_KIND_OFFICIAL && $order->inventoryDocuments()->exists()) {
            throw ValidationException::withMessages([
                'order_kind' => 'Không thể chuyển đơn đã có phiếu kho sang nhóm khác.',
            ]);
        }
    }

    private function duplicateOrderToKind(Order $original, string $targetKind): Order
    {
        $targetKind = $this->normalizeOrderKind($targetKind);

        if ($this->requiresOfficialValidation($targetKind)) {
            $this->validateOfficialOrderPayload([
                'province' => $original->province,
                'district' => $original->district,
                'ward' => $original->ward,
                'shipping_address' => $original->shipping_address,
            ], filled($original->district) ? 'old' : 'new');
            $this->validateOfficialOrderItems($original->items);
        }

        return $this->runOrderNumberMutation($targetKind, function () use ($original, $targetKind) {
            return DB::transaction(function () use ($original, $targetKind) {
                $recordedAt = now();
                $newOrder = $original->replicate([
                    'order_number',
                    'customer_id',
                    'draft_created_at',
                    'officialized_at',
                    'shipping_status',
                    'shipping_synced_at',
                    'shipping_status_source',
                    'shipping_carrier_code',
                    'shipping_carrier_name',
                    'shipping_tracking_code',
                    'shipping_dispatched_at',
                    'shipping_issue_code',
                    'shipping_issue_message',
                    'shipping_issue_detected_at',
                    'deleted_at',
                ]);

                $newOrder->order_number = $this->generateOrderNumber($targetKind);
                $newOrder->order_kind = $targetKind;
                $newOrder->user_id = Auth::id();
                $newOrder->lead_id = null;
                $newOrder->converted_from_order_id = $original->id;
                $newOrder->converted_from_kind = $this->normalizeOrderKind((string) $original->order_kind);
                $newOrder->customer_id = null;
                $newOrder->status = $this->defaultStatusForKind($original->account_id, $targetKind, 'new');
                $newOrder->shipment_status = 'Chưa giao';
                $newOrder->forceFill($this->filterPersistableOrderData(array_merge(
                    $this->freshShippingState(),
                    $this->supplementReturnTrackingPayload((string) $newOrder->order_type),
                    $this->initialOrderKindTimestampPayload($targetKind, $recordedAt)
                )));
                $newOrder->save();

                $rawItems = $original->items->map(function (OrderItem $item) {
                    return [
                        'product_id' => $item->product_id,
                        'name' => $item->product_name_snapshot,
                        'sku' => $item->product_sku_snapshot,
                        'sort_order' => (int) ($item->sort_order ?? 0),
                        'quantity' => $item->quantity,
                        'price' => $item->price,
                        'cost_price' => $item->cost_price,
                        'options' => $item->options,
                    ];
                })->all();

                $summary = $this->syncOrderItems(
                    $newOrder,
                    $rawItems,
                    $targetKind,
                    $this->shouldManageInventory($targetKind)
                );
                $rawSupplementItems = $this->orderSupplementItemsTableExists()
                    ? $original->supplementItems->map(function ($item) {
                        return [
                            'product_id' => $item->product_id,
                            'name' => $item->product_name_snapshot,
                            'sku' => $item->product_sku_snapshot,
                            'quantity' => $item->quantity,
                            'price' => $item->price,
                            'cost_price' => $item->cost_price,
                            'notes' => $item->notes,
                        ];
                    })->all()
                    : [];

                $supplementSummary = $this->normalizeOrderType((string) $newOrder->order_type) === self::ORDER_TYPE_STANDARD
                    ? $this->syncSupplementItems($newOrder, [])
                    : $this->syncSupplementItems($newOrder, $rawSupplementItems);
                $this->recalculateOrderTotals(
                    $newOrder,
                    (float) ($summary['total_price'] ?? 0),
                    (float) ($summary['cost_total'] ?? 0),
                    (string) $newOrder->order_type,
                    (float) ($newOrder->settlement_delta ?? 0),
                    (float) ($supplementSummary['total_price'] ?? 0),
                    (float) ($supplementSummary['cost_total'] ?? 0)
                );

                foreach ($original->attributeValues as $attributeValue) {
                    $newValue = $attributeValue->replicate();
                    $newValue->order_id = $newOrder->id;
                    $newValue->save();
                }

                if ($this->shouldManageInventory($targetKind)) {
                    $this->syncOfficialCustomerAndInvoice($newOrder, true);
                }

                return $newOrder;
            });
        });
    }

    private function convertOrderToKind(Order $order, string $targetKind, array $payload = []): Order
    {
        $targetKind = $this->normalizeOrderKind($targetKind);
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);

        $this->guardConvertOrderKind($order, $targetKind);

        if ($this->requiresOfficialValidation($targetKind)) {
            $this->validateOfficialOrderPayload([
                'province' => $payload['province'] ?? $order->province,
                'district' => $payload['district'] ?? $order->district,
                'ward' => $payload['ward'] ?? $order->ward,
                'shipping_address' => $payload['shipping_address'] ?? $order->shipping_address,
            ], (string) ($payload['region_type'] ?? 'new'));
            $this->validateOfficialOrderItems($order->items);
        }

        return $this->runOrderNumberMutation($targetKind, function () use ($order, $targetKind, $currentKind) {
            return DB::transaction(function () use ($order, $targetKind, $currentKind) {
                $transitionedAt = now();

                if ($this->shouldManageInventory($currentKind)) {
                    $this->releaseInventoryIfNeeded($order);
                    $this->removeOfficialSideEffects($order);
                }

                $order->forceFill(array_merge([
                    'order_kind' => $targetKind,
                    'converted_from_order_id' => $order->converted_from_order_id ?: $order->id,
                    'converted_from_kind' => $currentKind,
                    'order_number' => $this->generateOrderNumber($targetKind, $order->id),
                    'status' => $this->defaultStatusForKind($order->account_id, $targetKind, $order->status),
                ], $this->freshShippingState(), $this->convertedOrderKindTimestampPayload($order, $targetKind, $transitionedAt)))->save();

                if ($this->shouldManageInventory($targetKind)) {
                    $summary = $this->reserveInventoryIfNeeded($order);
                    $this->recalculateOrderTotals($order, (float) ($summary['total_price'] ?? 0), (float) ($summary['cost_total'] ?? 0));
                    $this->syncOfficialCustomerAndInvoice($order, false);
                }

                return $order;
            });
        });
    }

    private function generateShipmentNumber(?int $accountId = null): string
    {
        $baseCount = Shipment::withoutGlobalScopes()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDate('created_at', today())
            ->count();

        do {
            $baseCount++;
            $shipmentNumber = 'VD-' . now()->format('Ymd') . '-' . str_pad((string) $baseCount, 4, '0', STR_PAD_LEFT);
        } while (
            Shipment::withoutGlobalScopes()
                ->where('shipment_number', $shipmentNumber)
                ->exists()
        );

        return $shipmentNumber;
    }

    private function generateOutsideDeliveryTrackingCode(): string
    {
        $prefix = self::OUTSIDE_DELIVERY_TRACKING_PREFIX;
        $likePattern = $prefix . '%';
        $normalizedLikePattern = Str::lower($likePattern);
        $matchPattern = '/^' . preg_quote($prefix, '/') . '(\d+)$/';

        return $this->withNamedLock('orders:outside-delivery-tracking', function () use ($matchPattern, $normalizedLikePattern, $prefix) {
            $orderCodes = Order::withoutGlobalScope('account_id')
                ->withTrashed()
                ->whereRaw('LOWER(shipping_tracking_code) LIKE ?', [$normalizedLikePattern])
                ->pluck('shipping_tracking_code');

            $shipmentCodes = Shipment::withoutGlobalScopes()
                ->withTrashed()
                ->where(function ($query) use ($normalizedLikePattern) {
                    $query
                        ->whereRaw('LOWER(tracking_number) LIKE ?', [$normalizedLikePattern])
                        ->orWhereRaw('LOWER(carrier_tracking_code) LIKE ?', [$normalizedLikePattern]);
                })
                ->get(['tracking_number', 'carrier_tracking_code'])
                ->flatMap(function (Shipment $shipment) {
                    return array_filter([
                        $shipment->tracking_number,
                        $shipment->carrier_tracking_code,
                    ], static fn ($value) => filled($value));
                });

            $maxSequence = $orderCodes
                ->concat($shipmentCodes)
                ->reduce(function (int $carry, $value) use ($matchPattern) {
                    $normalizedValue = Str::lower(trim((string) $value));

                    if (!preg_match($matchPattern, $normalizedValue, $matches)) {
                        return $carry;
                    }

                    return max($carry, (int) ($matches[1] ?? 0));
                }, self::OUTSIDE_DELIVERY_TRACKING_SEQUENCE_START - 1);

            $nextSequence = max(self::OUTSIDE_DELIVERY_TRACKING_SEQUENCE_START, $maxSequence + 1);

            while (true) {
                $candidate = $prefix . $nextSequence;
                $normalizedCandidate = Str::lower($candidate);

                $orderExists = Order::withoutGlobalScope('account_id')
                    ->withTrashed()
                    ->whereRaw('LOWER(shipping_tracking_code) = ?', [$normalizedCandidate])
                    ->exists();

                $shipmentExists = Shipment::withoutGlobalScopes()
                    ->withTrashed()
                    ->where(function ($query) use ($normalizedCandidate) {
                        $query
                            ->whereRaw('LOWER(tracking_number) = ?', [$normalizedCandidate])
                            ->orWhereRaw('LOWER(carrier_tracking_code) = ?', [$normalizedCandidate]);
                    })
                    ->exists();

                if (!$orderExists && !$shipmentExists) {
                    return $candidate;
                }

                $nextSequence++;
            }
        });
    }

    private function resolveManualCarrierMeta(string $carrierName): array
    {
        $normalizedName = trim($carrierName);

        if ($normalizedName === '') {
            return ['code' => null, 'name' => null];
        }

        $carrier = Carrier::query()
            ->where(function ($query) use ($normalizedName) {
                $query
                    ->where('code', $normalizedName)
                    ->orWhereRaw('LOWER(name) = ?', [Str::lower($normalizedName)]);
            })
            ->first();

        return [
            'code' => $carrier?->code,
            'name' => $carrier?->name ?: $normalizedName,
        ];
    }

    private function normalizeQuickDispatchMode(mixed $mode): string
    {
        $normalized = Str::lower(trim((string) $mode));

        return in_array($normalized, self::QUICK_DISPATCH_MODES, true)
            ? $normalized
            : self::QUICK_DISPATCH_MODE_MANUAL_SHIPMENT;
    }

    private function normalizeOutsideDeliveryType(mixed $value): ?string
    {
        $normalized = Str::lower(trim((string) $value));

        return in_array($normalized, self::OUTSIDE_DELIVERY_TYPES, true)
            ? $normalized
            : null;
    }

    private function formatOutsideDeliveryTypeLabel(?string $value): string
    {
        return self::OUTSIDE_DELIVERY_TYPE_LABELS[(string) $value] ?? self::OUTSIDE_DELIVERY_TYPE_LABELS['khac'];
    }

    private function hasLegacyDispatchMarker(Order $order): bool
    {
        if (
            filled($order->shipping_tracking_code)
            || filled($order->shipping_carrier_code)
            || filled($order->shipping_carrier_name)
        ) {
            return true;
        }

        if ($order->shipping_dispatched_at || filled($order->shipping_status)) {
            return true;
        }

        if ($this->orderTableHasColumn('external_delivery_meta') && !empty($order->external_delivery_meta)) {
            return true;
        }

        return false;
    }

    private function buildOutsideDeliveryMetaPayload(array $shipmentInput): array
    {
        $deliveryType = $this->normalizeOutsideDeliveryType($shipmentInput['external_delivery_type'] ?? null);
        $contactName = trim((string) ($shipmentInput['external_delivery_contact'] ?? ''));
        $note = trim((string) ($shipmentInput['external_note'] ?? ''));

        return array_filter([
            'mode' => self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY,
            'delivery_type' => $deliveryType,
            'delivery_type_label' => $this->formatOutsideDeliveryTypeLabel($deliveryType),
            'contact_name' => $contactName !== '' ? $contactName : null,
            'shipping_cost' => (float) ($shipmentInput['shipping_cost'] ?? 0),
            'note' => $note !== '' ? $note : null,
        ], static fn ($value) => $value !== null);
    }

    private function buildOutsideDeliverySummary(array $meta): string
    {
        $parts = ['Gửi ngoài'];

        if (!empty($meta['delivery_type'])) {
            $parts[] = $this->formatOutsideDeliveryTypeLabel((string) $meta['delivery_type']);
        }

        if (!empty($meta['contact_name'])) {
            $parts[] = trim((string) $meta['contact_name']);
        }

        return implode(' · ', $parts);
    }

    private function buildQuickDispatchExportItems(Order $order): array
    {
        $order->loadMissing(['items.product:id,sku,name,price']);

        $invalidItem = $order->items->first(function (OrderItem $item) {
            return (int) ($item->quantity ?? 0) > 0 && (int) ($item->product_id ?? 0) <= 0;
        });

        if ($invalidItem instanceof OrderItem) {
            $productName = trim((string) ($invalidItem->product_name_snapshot ?: 'dÃ²ng sáº£n pháº©m khÃ´ng xÃ¡c Ä‘á»‹nh'));

            throw ValidationException::withMessages([
                'order' => ["ÄÆ¡n {$order->order_number} cÃ³ {$productName} chÆ°a liÃªn káº¿t sáº£n pháº©m kho nÃªn khÃ´ng thá»ƒ tá»± táº¡o phiáº¿u xuáº¥t."],
            ]);
        }

        $items = $order->items
            ->filter(function (OrderItem $item) {
                return (int) ($item->product_id ?? 0) > 0 && (int) ($item->quantity ?? 0) > 0;
            })
            ->groupBy(fn (OrderItem $item) => (int) $item->product_id)
            ->map(function (Collection $groupedItems, int $productId) {
                /** @var OrderItem|null $firstItem */
                $firstItem = $groupedItems->first();
                $quantity = (int) $groupedItems->sum(fn (OrderItem $item) => (int) ($item->quantity ?? 0));
                $lineTotal = (float) $groupedItems->sum(function (OrderItem $item) {
                    return round((float) ($item->price ?? 0) * (int) ($item->quantity ?? 0), 2);
                });
                $fallbackPrice = (float) ($firstItem?->price ?? $firstItem?->product?->price ?? 0);
                $unitPrice = $quantity > 0
                    ? round($lineTotal / $quantity, 2)
                    : round($fallbackPrice, 2);

                return [
                    'product_id' => $productId,
                    'quantity' => $quantity,
                    'unit_price' => $unitPrice,
                ];
            })
            ->filter(fn (array $item) => (int) ($item['quantity'] ?? 0) > 0)
            ->values()
            ->all();

        if (empty($items)) {
            throw ValidationException::withMessages([
                'order' => ["ÄÆ¡n {$order->order_number} khÃ´ng cÃ³ sáº£n pháº©m há»£p lá»‡ Ä‘á»ƒ tá»± táº¡o phiáº¿u xuáº¥t."],
            ]);
        }

        return $items;
    }

    private function buildQuickDispatchExportNote(
        string $dispatchMode,
        ?string $carrierName = null,
        ?string $trackingNumber = null,
        array $outsideMeta = []
    ): ?string {
        $parts = [self::QUICK_DISPATCH_EXPORT_NOTE_PREFIX];
        $carrierName = trim((string) $carrierName);
        $trackingNumber = trim((string) $trackingNumber);

        if ($dispatchMode === self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY) {
            $outsideSummary = $this->buildOutsideDeliverySummary($outsideMeta);
            if ($outsideSummary !== '') {
                $parts[] = $outsideSummary;
            }
        } else {
            if ($trackingNumber !== '') {
                $parts[] = 'MÃ£ váº­n Ä‘Æ¡n: ' . $trackingNumber;
            }

            if ($carrierName !== '') {
                $parts[] = 'ÄÆ¡n vá»‹: ' . $carrierName;
            }
        }

        $parts = array_values(array_filter($parts, fn ($value) => trim((string) $value) !== ''));

        return empty($parts) ? null : implode(' • ', $parts);
    }

    private function buildQuickDispatchExportMeta(
        Order $order,
        string $dispatchMode,
        ?string $carrierName = null,
        ?string $trackingNumber = null,
        array $outsideMeta = []
    ): array {
        $meta = [
            'source' => self::QUICK_DISPATCH_EXPORT_META_SOURCE,
            'dispatch_mode' => $dispatchMode,
            'order_id' => (int) $order->id,
            'order_number' => $order->order_number,
            'carrier_name' => trim((string) $carrierName) ?: null,
            'tracking_number' => trim((string) $trackingNumber) ?: null,
        ];

        if ($dispatchMode === self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY) {
            $meta['outside_delivery_type'] = $outsideMeta['delivery_type'] ?? null;
            $meta['outside_delivery_type_label'] = $outsideMeta['delivery_type_label'] ?? null;
            $meta['outside_delivery_contact'] = $outsideMeta['contact_name'] ?? null;
            $meta['outside_delivery_note'] = $outsideMeta['note'] ?? null;
        }

        return array_filter($meta, fn ($value) => $value !== null && $value !== '');
    }

    private function createQuickDispatchExportDocument(
        Order $order,
        string $dispatchMode,
        ?string $carrierName = null,
        ?string $trackingNumber = null,
        array $outsideMeta = [],
        ?\Illuminate\Support\Carbon $dispatchedAt = null
    ): InventoryDocument {
        return app(InventoryService::class)->createDocument(
            'export',
            [
                'document_date' => ($dispatchedAt ?: now())->toDateString(),
                'reference_type' => 'order',
                'reference_id' => (int) $order->id,
                'notes' => $this->buildQuickDispatchExportNote(
                    $dispatchMode,
                    $carrierName,
                    $trackingNumber,
                    $outsideMeta
                ),
                'meta' => $this->buildQuickDispatchExportMeta(
                    $order,
                    $dispatchMode,
                    $carrierName,
                    $trackingNumber,
                    $outsideMeta
                ),
                'allow_oversold' => true,
                'items' => $this->buildQuickDispatchExportItems($order),
            ],
            (int) $order->account_id,
            auth()->id()
        );
    }

    private function assertOrderCanQuickDispatch(Order $order): void
    {
        $activeShipment = Shipment::query()
            ->where('order_id', (int) $order->id)
            ->whereNull('deleted_at')
            ->whereNotIn('shipment_status', ['canceled'])
            ->latest('id')
            ->first();

        if ($activeShipment) {
            throw new \RuntimeException("Đơn đã có vận đơn {$activeShipment->shipment_number}.");
        }

        if ($this->hasLegacyDispatchMarker($order)) {
            $outsideSummary = $this->orderTableHasColumn('external_delivery_meta') && is_array($order->external_delivery_meta)
                ? $this->buildOutsideDeliverySummary($order->external_delivery_meta)
                : '';

            if ($outsideSummary !== '') {
                throw new \RuntimeException("Đơn đã được ghi nhận {$outsideSummary}.");
            }

            if (filled($order->shipping_tracking_code)) {
                throw new \RuntimeException("Đơn đã có mã vận đơn {$order->shipping_tracking_code}.");
            }

            throw new \RuntimeException('Đơn đã được ghi nhận gửi hàng trước đó.');
        }
    }

    private function createOutsideDispatchForOrder(Order $order, array $shipmentInput): Order
    {
        return DB::transaction(function () use ($order, $shipmentInput) {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();

            $this->assertOrderCanQuickDispatch($lockedOrder);

            $meta = $this->buildOutsideDeliveryMetaPayload($shipmentInput);
            $carrierSummary = $this->buildOutsideDeliverySummary($meta);
            $trackingCode = $this->generateOutsideDeliveryTrackingCode();
            $now = now();

            \App\Models\OrderStatusLog::query()->create([
                'order_id' => $lockedOrder->id,
                'from_status' => $lockedOrder->status,
                'to_status' => 'shipping',
                'from_shipping_status' => $lockedOrder->shipping_status,
                'to_shipping_status' => 'out_for_delivery',
                'source' => 'manual_outside_dispatch',
                'changed_by' => auth()->id(),
                'reason' => 'Gửi ngoài từ quản lý đơn hàng',
            ]);

            $lockedOrder->forceFill($this->filterPersistableOrderData([
                'status' => 'shipping',
                'shipment_status' => 'shipped',
                'internal_shipping_fee' => max(0, round((float) ($shipmentInput['shipping_cost'] ?? 0), 2)),
                'shipping_status' => 'out_for_delivery',
                'shipping_synced_at' => $now,
                'shipping_status_source' => self::SHIPPING_STATUS_SOURCE_MANUAL,
                'shipping_carrier_code' => self::OUTSIDE_DELIVERY_CARRIER_CODE,
                'shipping_carrier_name' => $carrierSummary,
                'shipping_tracking_code' => $trackingCode,
                'shipping_dispatched_at' => $now,
                'shipping_issue_code' => null,
                'shipping_issue_message' => null,
                'shipping_issue_detected_at' => null,
                'external_delivery_meta' => $meta,
            ]))->save();

            $this->createQuickDispatchExportDocument(
                $lockedOrder,
                self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY,
                $carrierSummary,
                null,
                $meta,
                $now
            );

            return $lockedOrder->fresh(['activeShipment']);
        });
    }

    private function createQuickShipmentForOrder(
        Order $order,
        array $shipmentInput,
        ShipmentStatusSyncService $syncService
    ): Shipment {
        return DB::transaction(function () use ($order, $shipmentInput, $syncService) {
            $activeShipment = $order->shipments()
                ->whereNotIn('shipment_status', ['canceled'])
                ->latest('id')
                ->first();

            if ($activeShipment) {
                throw new \RuntimeException("Đơn đã có vận đơn {$activeShipment->shipment_number}.");
            }

            $carrierMeta = $this->resolveManualCarrierMeta((string) $shipmentInput['carrier_name']);
            $trackingNumber = trim((string) $shipmentInput['tracking_number']);
            $shippingCost = (float) $shipmentInput['shipping_cost'];
            $codAmount = max(0, (float) ($order->total_price ?? 0));

            $shipment = Shipment::create([
                'account_id' => $order->account_id,
                'order_id' => $order->id,
                'order_code' => $order->order_number,
                'shipment_number' => $this->generateShipmentNumber($order->account_id),
                'tracking_number' => $trackingNumber,
                'carrier_tracking_code' => $trackingNumber,
                'carrier_code' => $carrierMeta['code'],
                'carrier_name' => $carrierMeta['name'],
                'channel' => 'manual',
                'customer_id' => $order->customer_id,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'customer_address' => $order->shipping_address,
                'customer_ward' => $order->ward,
                'customer_district' => $order->district,
                'customer_province' => $order->province,
                'status' => 'out_for_delivery',
                'shipment_status' => 'out_for_delivery',
                'order_status_snapshot' => $order->status,
                'cod_amount' => $codAmount,
                'shipping_cost' => $shippingCost,
                'service_fee' => 0,
                'actual_received_amount' => max(0, $codAmount - $shippingCost),
                'created_by' => auth()->id(),
                'shipped_at' => now(),
                'out_for_delivery_at' => now(),
                'extra_data' => [
                    'manual_quick_dispatch' => true,
                    'manual_input' => [
                        'tracking_number' => $trackingNumber,
                        'carrier_name' => $carrierMeta['name'],
                        'shipping_cost' => $shippingCost,
                    ],
                ],
            ]);

            OrderItem::query()
                ->where('order_id', $order->id)
                ->get()
                ->each(function (OrderItem $item) use ($shipment) {
                    ShipmentItem::create([
                        'shipment_id' => $shipment->id,
                        'order_item_id' => $item->id,
                        'qty' => $item->quantity,
                    ]);
                });

            ShipmentStatusLog::create([
                'shipment_id' => $shipment->id,
                'from_status' => null,
                'to_status' => 'out_for_delivery',
                'changed_by' => auth()->id(),
                'change_source' => 'manual',
                'reason' => 'Gửi vận chuyển nhanh từ quản lý đơn hàng',
            ]);

            $syncService->syncOrderFromShipment($shipment, 'manual_quick_dispatch', auth()->id());

            return $shipment->fresh(['order', 'items.orderItem.product']);
        });
    }

    private function resolveAccountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    private function scopedOrderQuery(Request $request, bool $withTrashed = false)
    {
        $query = $withTrashed ? Order::withTrashed() : Order::query();
        $accountId = $this->resolveAccountId($request);

        if ($accountId > 0) {
            $query->where('account_id', $accountId);
        }

        return $query;
    }

    private function findScopedOrder(Request $request, int $id, bool $withTrashed = false): Order
    {
        return $this->scopedOrderQuery($request, $withTrashed)->findOrFail($id);
    }

    private function applyOrderListFilters($query, Request $request): void
    {
        $accountId = $this->resolveAccountId($request);
        $searchTerms = $this->extractSearchTerms($request);

        if ($request->input('trashed') == '1') {
            $query->onlyTrashed();
        }

        $requestedKind = $this->normalizeOrderKind($request->input('order_kind'));
        if ($request->input('trashed') != '1') {
            $query->where(function ($kindQuery) use ($requestedKind) {
                $kindQuery
                    ->where('order_kind', $requestedKind)
                    ->orWhere(function ($fallbackQuery) use ($requestedKind) {
                        if ($requestedKind !== self::ORDER_KIND_OFFICIAL) {
                            $fallbackQuery->whereRaw('1 = 0');
                            return;
                        }

                        $fallbackQuery
                            ->whereNull('order_kind')
                            ->orWhere('order_kind', '');
                    });
            });
        }

        if ($request->filled('order_type')) {
            $requestedOrderTypes = $this->extractRequestedOrderTypes($request->input('order_type'));

            if ($requestedOrderTypes->isEmpty()) {
                $query->whereRaw('1 = 0');
            } else {
                $query->where(function ($orderTypeQuery) use ($requestedOrderTypes) {
                    $explicitTypes = $requestedOrderTypes
                        ->reject(fn (string $type) => $type === self::ORDER_TYPE_STANDARD)
                        ->values()
                        ->all();

                    if (!empty($explicitTypes)) {
                        $orderTypeQuery->whereIn('order_type', $explicitTypes);
                    }

                    if ($requestedOrderTypes->contains(self::ORDER_TYPE_STANDARD)) {
                        $standardScope = function ($standardQuery) {
                            $standardQuery
                                ->where('order_type', self::ORDER_TYPE_STANDARD)
                                ->orWhereNull('order_type')
                                ->orWhere('order_type', '');
                        };

                        if (!empty($explicitTypes)) {
                            $orderTypeQuery->orWhere($standardScope);
                        } else {
                            $orderTypeQuery->where($standardScope);
                        }
                    }
                });
            }
        }

        if ($request->filled('order_ids')) {
            $orderIds = collect(
                is_array($request->input('order_ids'))
                    ? $request->input('order_ids')
                    : explode(',', (string) $request->input('order_ids'))
            )
                ->map(fn ($value) => (int) $value)
                ->filter(fn (int $id) => $id > 0)
                ->unique()
                ->values();

            if ($orderIds->isEmpty()) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn('orders.id', $orderIds->all());
            }
        }

        $query
            ->when(!empty($searchTerms), function ($q) use ($searchTerms, $accountId) {
                $q->where(function ($searchQuery) use ($searchTerms, $accountId) {
                    foreach ($searchTerms as $index => $term) {
                        $method = $index === 0 ? 'where' : 'orWhere';
                        $searchQuery->{$method}(function ($termQuery) use ($term, $accountId) {
                            $this->applyOrderSearchTerm($termQuery, $term, $accountId);
                        });
                    }
                });
            })
            ->when($request->filled('customer_name'), function ($q) use ($request, $accountId) {
                $this->applyOrderNameSearch($q, (string) $request->input('customer_name'), $accountId);
            })
            ->when($request->filled('order_number'), function ($q) use ($request) {
                $this->applyInsensitiveLike($q, 'order_number', $this->containsLike((string) $request->input('order_number')));
            })
            ->when($request->filled('customer_phone'), function ($q) use ($request, $accountId) {
                $this->applyOrderPhoneSearch($q, (string) $request->input('customer_phone'), $accountId, false, true);
            })
            ->when($request->filled('shipping_address'), function ($q) use ($request) {
                $this->applyInsensitiveLike($q, 'shipping_address', $this->containsLike((string) $request->input('shipping_address')));
            })
            ->when($request->filled('return_tracking_code'), function ($q) use ($request) {
                $this->applyInsensitiveLike($q, 'return_tracking_code', $this->containsLike((string) $request->input('return_tracking_code')));
            })
            ->when($request->filled('status'), function ($q) use ($request) {
                $statuses = $this->extractRequestedStatusCodes($request->input('status'));

                if ($statuses->isEmpty()) {
                    $q->whereRaw('1 = 0');
                    return;
                }

                $q->whereIn('status', $statuses->all());
            })
            ->when($request->filled('created_at_from'), function ($q) use ($request) {
                $this->applyOrderDisplayDateFilter($q, '>=', (string) $request->input('created_at_from'));
            })
            ->when($request->filled('created_at_to'), function ($q) use ($request) {
                $this->applyOrderDisplayDateFilter($q, '<=', (string) $request->input('created_at_to'));
            })
            ->when($request->filled('shipping_carrier_code'), function ($q) use ($request) {
                $q->where('shipping_carrier_code', $request->input('shipping_carrier_code'));
            })
            ->when($request->filled('shipping_dispatched_from'), function ($q) use ($request) {
                $q->whereDate('shipping_dispatched_at', '>=', $request->input('shipping_dispatched_from'));
            })
            ->when($request->filled('shipping_dispatched_to'), function ($q) use ($request) {
                $q->whereDate('shipping_dispatched_at', '<=', $request->input('shipping_dispatched_to'));
            })
            ->when($request->filled('export_slip_state'), function ($q) use ($request) {
                $state = trim((string) $request->input('export_slip_state'));
                $this->orderInventorySlipService->applyExportSlipStateFilter($q, $state);
            })
            ->when($request->filled('return_slip_state'), function ($q) use ($request) {
                $state = trim((string) $request->input('return_slip_state'));
                $this->orderInventorySlipService->applyReturnSlipStateFilter($q, $state);
            })
            ->when($request->filled('damaged_slip_state'), function ($q) use ($request) {
                $state = trim((string) $request->input('damaged_slip_state'));
                $this->orderInventorySlipService->applyDamagedSlipStateFilter($q, $state);
            });

        foreach ($request->all() as $key => $value) {
            if (strpos($key, 'attr_order_') !== 0 || empty($value)) {
                continue;
            }

            $attrId = str_replace('attr_order_', '', $key);
            $query->whereExists(function ($attributeQuery) use ($attrId, $value) {
                $attributeQuery->select(DB::raw(1))
                    ->from('order_attribute_values')
                    ->whereRaw('order_attribute_values.order_id = orders.id')
                    ->where('attribute_id', $attrId)
                    ->whereRaw($this->loweredSearchExpression('value') . " LIKE ? ESCAPE '\\'", [
                        $this->containsLike((string) $value),
                    ]);
            });
        }
    }

    private function emptyOrderListSummary(): array
    {
        return [
            'order_count' => 0,
            'total_price' => 0.0,
            'shipping_fee' => 0.0,
            'goods_total' => 0.0,
        ];
    }

    private function resolveOrderListGoodsTotal(Order $order): float
    {
        $discount = $this->orderTableHasColumn('discount')
            ? (float) ($order->discount ?? 0)
            : 0.0;

        return round((float) ($order->total_price ?? 0) + $discount, 2);
    }

    private function calculateOrderListSummary($query): array
    {
        $summary = $this->emptyOrderListSummary();

        $summaryQuery = clone $query;
        $summaryQuery->setEagerLoads([]);
        $summaryQuery->with([
            'activeShipment:id,order_id,shipping_cost',
        ]);
        $summaryQuery->select($this->selectExistingOrderColumns([
            'id',
            'total_price',
            'discount',
            'internal_shipping_fee',
            'external_delivery_meta',
        ]));

        $summaryQuery->chunkById(200, function (Collection $orders) use (&$summary) {
            foreach ($orders as $order) {
                $summary['order_count']++;
                $summary['total_price'] += round((float) ($order->total_price ?? 0), 2);
                $summary['shipping_fee'] += $this->resolveOrderInternalShippingFee($order);
                $summary['goods_total'] += $this->resolveOrderListGoodsTotal($order);
            }
        }, 'orders.id', 'id');

        return [
            'order_count' => (int) $summary['order_count'],
            'total_price' => round((float) $summary['total_price'], 2),
            'shipping_fee' => round((float) $summary['shipping_fee'], 2),
            'goods_total' => round((float) $summary['goods_total'], 2),
        ];
    }

    private function repeatPhoneMetaForOrder(array $repeatMetaMap, int $orderId): array
    {
        return $repeatMetaMap["order:{$orderId}"] ?? [
            'is_repeat_customer_phone' => false,
            'repeat_phone_previous_count' => 0,
            'normalized_phone' => null,
            'has_duplicate_phone' => false,
            'has_duplicate_phone_with_matching_product' => false,
            'duplicate_phone_color' => 'default',
        ];
    }

    private function transformOrderListItems(Collection $orders, int $accountId): Collection
    {
        $repeatMetaMap = $this->repeatCustomerPhoneService->buildOrderMeta($orders, $accountId);
        $inventorySlipSummaryMap = $this->orderInventorySlipService->buildListSummaryMap($orders);
        $nameAttributeIds = $this->candidateOrderNameAttributeIds($accountId);
        $phoneAttributeIds = $this->candidateOrderPhoneAttributeIds($accountId);

        return $orders->map(function (Order $order) use ($repeatMetaMap, $inventorySlipSummaryMap, $nameAttributeIds, $phoneAttributeIds) {
            $this->attachResolvedInternalShippingFee($order);
            $payload = $order->toArray();
            $payload['customer_name'] = $this->resolveOrderDisplayCustomerName($order, $nameAttributeIds);
            $payload['customer_phone'] = $this->resolveOrderDisplayCustomerPhone($order, $phoneAttributeIds);

            return array_merge(
                $payload,
                $this->appendOrderTimePayload([], $order),
                $this->repeatPhoneMetaForOrder($repeatMetaMap, (int) $order->id),
                [
                    'inventory_slip_summary' => $inventorySlipSummaryMap[(int) $order->id] ?? null,
                ]
            );
        })->values();
    }

    private function connectedCarrierCacheKey(int $accountId): string
    {
        return "orders:connected-carriers:{$accountId}";
    }

    private function bootstrapCacheKey(int $accountId, string $mode): string
    {
        return OrderBootstrapCache::key($accountId, $mode);
    }

    private function loadOrderKindCounts(int $accountId): array
    {
        $baseCounts = Order::query()
            ->where('account_id', $accountId)
            ->selectRaw('COALESCE(order_kind, ?) as order_kind, COUNT(*) as aggregate', [self::ORDER_KIND_OFFICIAL])
            ->groupBy('order_kind')
            ->pluck('aggregate', 'order_kind');

        return [
            self::ORDER_KIND_OFFICIAL => (int) ($baseCounts[self::ORDER_KIND_OFFICIAL] ?? 0),
            self::ORDER_KIND_TEMPLATE => (int) ($baseCounts[self::ORDER_KIND_TEMPLATE] ?? 0),
            self::ORDER_KIND_DRAFT => (int) ($baseCounts[self::ORDER_KIND_DRAFT] ?? 0),
            'trash' => (int) Order::onlyTrashed()->where('account_id', $accountId)->count(),
        ];
    }

    private function loadConnectedCarriers(int $accountId): array
    {
        return Cache::remember(
            $this->connectedCarrierCacheKey($accountId),
            now()->addSeconds(self::BOOTSTRAP_CACHE_TTL_SECONDS),
            function () use ($accountId) {
                return ShippingIntegration::query()
                    ->where('account_id', $accountId)
                    ->where('is_enabled', true)
                    ->where(function ($query) {
                        $query
                            ->where('connection_status', 'connected')
                            ->orWhere('connection_status', 'configured')
                            ->orWhereNotNull('access_token');
                    })
                    ->orderBy('carrier_name')
                    ->with('defaultWarehouse:id,name')
                    ->get([
                        'carrier_code',
                        'carrier_name',
                        'connection_status',
                        'is_enabled',
                        'access_token',
                        'webhook_url',
                        'default_warehouse_id',
                    ])
                    ->map(function (ShippingIntegration $integration) {
                        $effectiveStatus = $integration->connection_status ?: 'configured';
                        if ($integration->is_enabled && filled($integration->access_token) && $effectiveStatus === 'disconnected') {
                            $effectiveStatus = 'configured';
                        }

                        return [
                            'carrier_code' => $integration->carrier_code,
                            'carrier_name' => $integration->carrier_name,
                            'connection_status' => $effectiveStatus,
                            'is_enabled' => $integration->is_enabled,
                            'webhook_url' => $integration->webhook_url,
                            'default_warehouse_id' => $integration->default_warehouse_id,
                            'default_warehouse_name' => $integration->defaultWarehouse?->name,
                        ];
                    })
                    ->values()
                    ->all();
            }
        );
    }

    private function loadOrderAttributes(string $entityType): array
    {
        return Attribute::query()
            ->with('options')
            ->byEntityType($entityType)
            ->where('status', true)
            ->ordered()
            ->get()
            ->toArray();
    }

    private function loadOrderStatuses(int $accountId): array
    {
        OrderStatusCatalog::ensureDefaultSystemStatuses($accountId);

        return OrderStatus::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->toArray();
    }

    private function buildPrintableAddress(Order $order): string
    {
        $parts = [];

        foreach ([$order->shipping_address, $order->ward, $order->district, $order->province] as $rawPart) {
            $part = trim((string) $rawPart);
            if ($part === '') {
                continue;
            }

            $exists = collect($parts)->contains(function (string $existing) use ($part) {
                $existingLower = Str::lower($existing);
                $partLower = Str::lower($part);

                return $existingLower === $partLower
                    || Str::contains($existingLower, $partLower)
                    || Str::contains($partLower, $existingLower);
            });

            if (!$exists) {
                $parts[] = $part;
            }
        }

        return implode(', ', $parts);
    }

    private function transformPrintableOrders(Collection $orders): array
    {
        return $orders
            ->map(function (Order $order) {
                return [
                    'id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $order->customer_name,
                    'customer_phone' => $order->customer_phone,
                    'shipping_address' => $this->buildPrintableAddress($order),
                    'notes' => trim((string) $order->notes),
                    'total_payment' => (float) $order->total_price,
                    'created_at' => $this->resolveOrderDisplayedAt($order)?->toISOString(),
                    'items' => $order->items
                        ->map(function (OrderItem $item) {
                            $productName = trim((string) ($item->product_name_snapshot ?: $item->product?->name ?: ('Sản phẩm #' . $item->product_id)));
                            $productSku = trim((string) ($item->product_sku_snapshot ?: $item->product?->sku ?: ''));
                            $quantity = (int) $item->quantity;
                            $unitPrice = (float) $item->price;

                            return [
                                'id' => (int) $item->id,
                                'name' => $productName,
                                'sku' => $productSku !== '' ? $productSku : null,
                                'quantity' => $quantity,
                                'unit_price' => $unitPrice,
                                'line_total' => round($quantity * $unitPrice, 2),
                            ];
                        })
                        ->values()
                        ->all(),
                ];
            })
            ->values()
            ->all();
    }

    private function loadQuoteSettings(int $accountId): array
    {
        $settings = array_fill_keys(self::QUOTE_SETTING_KEYS, '');

        return array_merge(
            $settings,
            SiteSetting::query()
                ->where('account_id', $accountId)
                ->whereIn('key', self::QUOTE_SETTING_KEYS)
                ->pluck('value', 'key')
                ->toArray()
        );
    }

    private function loadOrderQuickPickGroups(int $accountId): array
    {
        $rawValue = SiteSetting::getValue(self::ORDER_QUICK_PICK_SETTING_KEY, $accountId, '[]');
        $decodedGroups = is_array($rawValue)
            ? $rawValue
            : json_decode((string) $rawValue, true);

        if (!is_array($decodedGroups)) {
            return [];
        }

        $normalizedGroups = collect($decodedGroups)
            ->map(function ($group, $groupIndex) {
                if (!is_array($group)) {
                    return null;
                }

                $attributeId = (int) ($group['attribute_id'] ?? 0);
                $attributeValue = trim((string) ($group['attribute_value'] ?? ''));

                if ($attributeId <= 0 || $attributeValue === '') {
                    return null;
                }

                $items = collect(is_array($group['items'] ?? null) ? $group['items'] : [])
                    ->map(function ($item, $itemIndex) {
                        if (!is_array($item)) {
                            return null;
                        }

                        $targetProductId = (int) ($item['target_product_id'] ?? $item['product_id'] ?? 0);
                        if ($targetProductId <= 0) {
                            return null;
                        }

                        $parentProductId = (int) ($item['parent_product_id'] ?? 0);
                        $type = strtolower(trim((string) ($item['type'] ?? '')));

                        return [
                            'id' => trim((string) ($item['id'] ?? '')) ?: "order-quick-pick-item-{$targetProductId}-" . ($itemIndex + 1),
                            'target_product_id' => $targetProductId,
                            'parent_product_id' => $parentProductId > 0 ? $parentProductId : null,
                            'type' => $type === 'variation' ? 'variation' : 'product',
                            'display_name' => trim((string) ($item['display_name'] ?? $item['name'] ?? '')),
                            'display_sku' => trim((string) ($item['display_sku'] ?? $item['sku'] ?? '')),
                            'option_label' => trim((string) ($item['option_label'] ?? '')),
                            'main_image' => trim((string) ($item['main_image'] ?? '')),
                            'price' => round((float) ($item['price'] ?? 0), 2),
                            'cost_price' => ImportCostRounding::roundUnitCost($item['cost_price'] ?? 0),
                            'order' => max(1, (int) ($item['order'] ?? ($itemIndex + 1))),
                        ];
                    })
                    ->filter()
                    ->sortBy('order')
                    ->take(15)
                    ->values()
                    ->all();

                return [
                    'id' => trim((string) ($group['id'] ?? '')) ?: "order-quick-pick-group-{$attributeId}-" . ($groupIndex + 1),
                    'attribute_id' => $attributeId,
                    'attribute_value' => $attributeValue,
                    'items' => $items,
                ];
            })
            ->filter()
            ->values();

        if ($normalizedGroups->isEmpty()) {
            return [];
        }

        $productIds = $normalizedGroups
            ->flatMap(function (array $group) {
                return collect($group['items'])->flatMap(fn (array $item) => array_filter([
                    (int) ($item['target_product_id'] ?? 0),
                    (int) ($item['parent_product_id'] ?? 0),
                ]));
            })
            ->filter()
            ->unique()
            ->values();

        if ($productIds->isEmpty()) {
            return $normalizedGroups->all();
        }

        $products = Product::query()
            ->where('account_id', $accountId)
            ->whereIn('id', $productIds)
            ->with([
                'images:id,product_id,image_url,is_primary,sort_order',
                'attributeValues:id,product_id,attribute_id,value',
                'unit:id,name',
            ])
            ->get()
            ->keyBy(fn (Product $product) => (int) $product->id);

        return $normalizedGroups
            ->map(function (array $group) use ($products) {
                $resolvedItems = collect($group['items'])
                    ->map(function (array $item) use ($products) {
                        /** @var Product|null $product */
                        $product = $products->get((int) ($item['target_product_id'] ?? 0));
                        if (!$product) {
                            return null;
                        }

                        /** @var Product|null $parentProduct */
                        $parentProduct = !empty($item['parent_product_id'])
                            ? $products->get((int) $item['parent_product_id'])
                            : null;

                        $primaryImage = $product->images->firstWhere('is_primary', true)
                            ?: $product->images->sortBy('sort_order')->first();
                        $parentPrimaryImage = $parentProduct
                            ? ($parentProduct->images->firstWhere('is_primary', true) ?: $parentProduct->images->sortBy('sort_order')->first())
                            : null;

                        return [
                            'id' => $item['id'],
                            'target_product_id' => (int) $product->id,
                            'parent_product_id' => $item['parent_product_id'],
                            'type' => $item['type'],
                            'display_name' => $item['display_name'] !== '' ? $item['display_name'] : trim((string) $product->name),
                            'display_sku' => $item['display_sku'] !== '' ? $item['display_sku'] : trim((string) $product->sku),
                            'option_label' => $item['option_label'],
                            'name' => trim((string) $product->name),
                            'sku' => trim((string) $product->sku),
                            'price' => round((float) ($product->price ?? 0), 2),
                            'cost_price' => ImportCostRounding::roundUnitCost($product->cost_price ?? $product->expected_cost ?? 0),
                            'unit_name' => $product->unit?->name
                                ?? $parentProduct?->unit?->name
                                ?? (trim((string) ($item['unit_name'] ?? '')) ?: ''),
                            'main_image' => $primaryImage?->image_url ?: $item['main_image'] ?: $parentPrimaryImage?->image_url,
                            'attribute_values' => $product->attributeValues
                                ->map(fn ($attributeValue) => [
                                    'attribute_id' => (int) $attributeValue->attribute_id,
                                    'value' => $attributeValue->value,
                                ])
                                ->values()
                                ->all(),
                        ];
                    })
                    ->filter()
                    ->values()
                    ->all();

                return [
                    ...$group,
                    'items' => $resolvedItems,
                ];
            })
            ->values()
            ->all();
    }

    public function bootstrap(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json([]);
        }

        $mode = strtolower((string) $request->input('mode', 'list'));
        if (!in_array($mode, ['list', 'form'], true)) {
            $mode = 'list';
        }

        $payload = Cache::remember(
            $this->bootstrapCacheKey($accountId, $mode),
            now()->addSeconds(self::BOOTSTRAP_CACHE_TTL_SECONDS),
            function () use ($accountId, $mode) {
                if ($mode === 'form') {
                    return [
                        'order_statuses' => $this->loadOrderStatuses($accountId),
                        'order_attributes' => $this->loadOrderAttributes('order'),
                        'product_attributes' => $this->loadOrderAttributes('product'),
                        'product_quick_pick_groups' => $this->loadOrderQuickPickGroups($accountId),
                        'quote_settings' => $this->loadQuoteSettings($accountId),
                        'quote_templates' => QuoteTemplate::query()
                            ->where('account_id', $accountId)
                            ->orderBy('sort_order')
                            ->orderBy('name')
                            ->get()
                            ->toArray(),
                    ];
                }

                return [
                    'order_statuses' => $this->loadOrderStatuses($accountId),
                    'order_attributes' => $this->loadOrderAttributes('order'),
                    'connected_carriers' => $this->loadConnectedCarriers($accountId),
                    'order_kind_counts' => $this->loadOrderKindCounts($accountId),
                ];
            }
        );

        return response()->json($payload);
    }

    public function index(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        // Base select for listing - avoid * to reduce payload
        $query = Order::query()
            ->where('account_id', $accountId)
            ->select($this->selectExistingOrderColumns([
                'id', 'order_number', 'total_price', 'cost_total', 'shipping_fee', 'internal_shipping_fee', 'status', 'customer_name',
                'customer_phone', 'shipping_address', 'province', 'district', 'ward', 'created_at', 'notes',
                'draft_created_at', 'officialized_at',
                'print_count', 'last_printed_at',
                'type', 'order_kind', 'order_type', 'converted_from_order_id', 'converted_from_kind',
                'shipping_status', 'shipping_carrier_code', 'shipping_carrier_name',
                'shipping_tracking_code', 'shipping_dispatched_at',
                'external_delivery_meta',
                'shipping_issue_code', 'shipping_issue_message', 'shipping_issue_detected_at',
                'deleted_at',
            ]))
            ->addSelect($this->orderDisplayTimestampSelect('orders'));

        // Eager load only what is needed for the table
        $query->with([
            'items' => fn ($itemQuery) => $itemQuery
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'actual_product_id',
                    'product_name_snapshot',
                    'actual_product_name_snapshot',
                    'product_sku_snapshot',
                    'actual_product_sku_snapshot',
                    'sort_order',
                    'quantity',
                    'price',
                ])
                ->orderBy('sort_order')
                ->orderBy('id')
                ->with([
                    'product' => fn ($productQuery) => $productQuery
                        ->select(['id', 'name', 'sku']),
                    'actualProduct' => fn ($productQuery) => $productQuery
                        ->select(['id', 'name', 'sku']),
                ]),
            'attributeValues:id,order_id,attribute_id,value',
            'activeShipment:id,order_id,shipment_number,carrier_name,carrier_tracking_code,shipment_status,problem_code,problem_message,problem_detected_at,customer_name,customer_phone,shipping_cost'
        ]);

        $this->applyOrderListFilters($query, $request);
        $summary = $this->calculateOrderListSummary($query);

        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        if ($sortBy === 'status') {
            $query->leftJoin('order_statuses', function($join) use ($accountId) {
                    $join->on('orders.status', '=', 'order_statuses.code')
                         ->where('order_statuses.account_id', '=', $accountId);
                })
                ->orderBy('order_statuses.sort_order', $sortOrder);
        } else {
            $validSortFields = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'cost_total', 'status', 'shipping_dispatched_at'];
            if ($this->orderTableHasColumn('shipping_fee')) {
                $validSortFields[] = 'shipping_fee';
            }
            $field = in_array($sortBy, $validSortFields) ? $sortBy : 'created_at';
            if ($field === 'created_at') {
                $query->orderByRaw($this->orderDisplayTimestampSql('orders') . ' ' . ($sortOrder === 'asc' ? 'asc' : 'desc'));
            } elseif ($field === 'shipping_fee' && $this->orderTableHasColumn('internal_shipping_fee')) {
                $query->orderBy('internal_shipping_fee', $sortOrder);
            } else {
                $query->orderBy($field, $sortOrder);
            }
        }

        $perPage = (int) $request->input('per_page', 20);
        // Ensure per_page is capped to prevent DOS
        $perPage = min(max($perPage, 1), 100);

        $paginator = $query->paginate($perPage);
        $paginator->setCollection(
            $this->transformOrderListItems(collect($paginator->items()), $accountId)
        );

        $response = $paginator->toArray();
        $response['order_kind_counts'] = $this->loadOrderKindCounts($accountId);
        $response['summary'] = $summary;

        return response()->json($response);
    }

    public function returnFollowups(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        $filter = $this->normalizeReturnFollowupFilter($request->input('category'));
        $searchTerms = $this->extractSearchTerms($request);
        $threshold = now()->subDays(self::RETURN_FOLLOWUP_MIN_STALLED_DAYS);
        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);

        $pendingReturnQuery = $this->buildPendingReturnFollowupQuery($accountId, $threshold);
        $exchangeReturnQuery = $this->buildExchangeReturnFollowupQuery($accountId, $threshold);
        $partialDeliveryQuery = $this->buildPartialDeliveryFollowupQuery($accountId, $threshold);

        if (!empty($searchTerms)) {
            $this->applyReturnFollowupSearch($pendingReturnQuery, $accountId, $searchTerms);
            $this->applyReturnFollowupSearch($exchangeReturnQuery, $accountId, $searchTerms);
            $this->applyReturnFollowupSearch($partialDeliveryQuery, $accountId, $searchTerms);
        }

        $counts = [
            self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN => $this->countReturnFollowupQuery(clone $pendingReturnQuery),
            self::RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN => $this->countReturnFollowupQuery(clone $exchangeReturnQuery),
            self::RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY => $this->countReturnFollowupQuery(clone $partialDeliveryQuery),
        ];
        $counts[self::RETURN_FOLLOWUP_FILTER_ALL] = array_sum($counts);

        $followupQuery = match ($filter) {
            self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN => clone $pendingReturnQuery,
            self::RETURN_FOLLOWUP_CATEGORY_EXCHANGE_RETURN => clone $exchangeReturnQuery,
            self::RETURN_FOLLOWUP_CATEGORY_PARTIAL_DELIVERY => clone $partialDeliveryQuery,
            default => (clone $pendingReturnQuery)
                ->unionAll(clone $exchangeReturnQuery)
                ->unionAll(clone $partialDeliveryQuery),
        };

        $paginator = DB::query()
            ->fromSub($followupQuery, 'return_followups')
            ->orderBy('relevant_date')
            ->orderBy('order_id')
            ->paginate($perPage);

        $followupRows = collect($paginator->items());
        $orderIds = $followupRows
            ->pluck('order_id')
            ->map(fn ($value) => (int) $value)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values();

        $nameAttributeIds = $this->candidateOrderNameAttributeIds($accountId);
        $phoneAttributeIds = $this->candidateOrderPhoneAttributeIds($accountId);
        $orders = $orderIds->isEmpty()
            ? collect()
            : Order::query()
                ->where('account_id', $accountId)
                ->whereIn('id', $orderIds->all())
                ->select($this->selectExistingOrderColumns([
                    'id',
                    'order_number',
                    'order_kind',
                    'order_type',
                    'status',
                    'customer_name',
                    'customer_phone',
                    'notes',
                    'return_tracking_code',
                    'return_status',
                    'shipping_tracking_code',
                    'shipping_dispatched_at',
                    'shipping_issue_detected_at',
                    'created_at',
                ]))
                ->with([
                    'attributeValues:id,order_id,attribute_id,value',
                    'activeShipment:id,order_id,carrier_tracking_code,tracking_number,customer_name,customer_phone,shipped_at',
                ])
                ->get()
                ->keyBy(fn (Order $order) => (int) $order->id);

        $now = now();
        $paginator->setCollection(
            $followupRows->map(function ($row) use ($orders, $nameAttributeIds, $phoneAttributeIds, $now) {
                $order = $orders->get((int) ($row->order_id ?? 0));

                if (!$order) {
                    return null;
                }

                $relevantDate = $this->normalizeOrderTimestamp($row->relevant_date ?? null);
                $trackingCode = $this->normalizeReturnTrackingCode($order->return_tracking_code)
                    ?? $this->normalizeReturnTrackingCode($order->shipping_tracking_code)
                    ?? $this->normalizeReturnTrackingCode(
                        $order->activeShipment?->carrier_tracking_code
                        ?: $order->activeShipment?->tracking_number
                    );
                $notes = trim((string) ($order->notes ?? ''));

                return [
                    'id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $this->resolveOrderDisplayCustomerName($order, $nameAttributeIds),
                    'customer_phone' => $this->resolveOrderDisplayCustomerPhone($order, $phoneAttributeIds),
                    'status' => (string) $order->status,
                    'order_type' => $this->normalizeOrderType((string) $order->order_type),
                    'followup_category' => (string) ($row->followup_category ?? self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN),
                    'tracking_code' => $trackingCode,
                    'return_tracking_code' => $this->normalizeReturnTrackingCode($order->return_tracking_code),
                    'shipping_tracking_code' => $this->normalizeReturnTrackingCode($order->shipping_tracking_code),
                    'shipping_dispatched_at' => $this->normalizeOrderTimestamp($order->shipping_dispatched_at)?->toISOString(),
                    'relevant_date' => $relevantDate?->toISOString(),
                    'relevant_date_mode' => (string) ($row->followup_category ?? '') === self::RETURN_FOLLOWUP_CATEGORY_PENDING_RETURN
                        ? 'status_changed'
                        : 'dispatched',
                    'stalled_days' => $relevantDate ? $relevantDate->diffInDays($now) : 0,
                    'notes' => $notes !== '' ? $notes : null,
                ];
            })->filter()->values()
        );

        $response = $paginator->toArray();
        $response['meta'] = [
            'filter' => $filter,
            'minimum_stalled_days' => self::RETURN_FOLLOWUP_MIN_STALLED_DAYS,
            'counts' => $counts,
            'search_terms' => $searchTerms,
        ];

        return response()->json($response);
    }

    public function quickSelect(Request $request)
    {
        $validated = $request->validate([
            'codes' => 'required|array|min:1|max:100',
            'codes.*' => 'required|string|max:255',
        ]);

        $preparedCodes = collect($validated['codes'])
            ->map(function ($code) {
                $rawCode = trim((string) $code);

                return [
                    'code' => $rawCode,
                    'normalized' => $this->normalizeSearchText($rawCode),
                ];
            })
            ->filter(fn (array $item) => $item['normalized'] !== '')
            ->values();

        if ($preparedCodes->isEmpty()) {
            return response()->json([
                'message' => 'Cần nhập ít nhất một mã để chọn nhanh.',
                'resolved_order_ids' => [],
                'resolved_orders' => [],
                'missing_codes' => [],
                'duplicate_codes' => [],
                'summary' => [
                    'submitted_count' => 0,
                    'matched_count' => 0,
                    'missing_count' => 0,
                    'duplicate_count' => 0,
                ],
            ]);
        }

        $query = $this->scopedOrderQuery($request)
            ->select($this->selectExistingOrderColumns([
                'id',
                'order_number',
                'customer_name',
                'status',
                'order_kind',
                'created_at',
                'draft_created_at',
                'officialized_at',
            ]))
            ->addSelect($this->orderDisplayTimestampSelect('orders'));

        $this->applyOrderListFilters($query, $request);

        $query->where(function ($codeQuery) use ($preparedCodes) {
            foreach ($preparedCodes as $index => $item) {
                $like = '%' . $this->escapeLike($item['normalized']) . '%';
                $this->applyInsensitiveLike($codeQuery, 'order_number', $like, $index > 0);
            }
        });

        $candidates = $query
            ->orderByRaw($this->orderDisplayTimestampSql('orders') . ' desc')
            ->orderByDesc('id')
            ->get()
            ->map(function (Order $order) {
                return [
                    'id' => (int) $order->id,
                    'order_number' => (string) $order->order_number,
                    'customer_name' => (string) ($order->customer_name ?? ''),
                    'status' => (string) ($order->status ?? ''),
                    'order_kind' => $this->normalizeOrderKind((string) $order->order_kind),
                    'created_at' => $order->created_at?->toISOString(),
                    'draft_created_at' => $this->resolveOrderDraftCreatedAt($order)?->toISOString(),
                    'officialized_at' => $this->resolveOrderOfficializedAt($order)?->toISOString(),
                    'displayed_at' => $this->resolveOrderDisplayedAt($order)?->toISOString(),
                    'normalized_order_number' => $this->normalizeSearchText((string) $order->order_number),
                ];
            })
            ->values();

        $resolvedOrdersById = [];
        $missingCodes = [];
        $duplicateCodes = [];

        $transformCandidate = static fn (array $candidate) => [
            'id' => $candidate['id'],
            'order_number' => $candidate['order_number'],
            'customer_name' => $candidate['customer_name'],
            'status' => $candidate['status'],
            'order_kind' => $candidate['order_kind'],
            'created_at' => $candidate['created_at'],
            'draft_created_at' => $candidate['draft_created_at'],
            'officialized_at' => $candidate['officialized_at'],
            'displayed_at' => $candidate['displayed_at'],
        ];

        foreach ($preparedCodes as $preparedCode) {
            $matches = $candidates
                ->filter(fn (array $candidate) => str_contains($candidate['normalized_order_number'], $preparedCode['normalized']))
                ->values();

            if ($matches->count() === 0) {
                $missingCodes[] = $preparedCode['code'];
                continue;
            }

            if ($matches->count() > 1) {
                $duplicateCodes[] = [
                    'code' => $preparedCode['code'],
                    'message' => 'Mã này đang trùng, cần nhập thêm ký tự để xác định chính xác.',
                    'match_count' => $matches->count(),
                    'matches' => $matches->map($transformCandidate)->all(),
                ];
                continue;
            }

            $matchedOrder = $transformCandidate($matches->first());
            $resolvedOrdersById[$matchedOrder['id']] = $matchedOrder;
        }

        $resolvedOrders = array_values($resolvedOrdersById);
        $selectedProductIds = [];
        $scopeLabel = '';

        $productScopeLabel = empty($selectedProductIds)
            ? null
            : (count($selectedProductIds) === 1
                ? '1 sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ä‘ÃƒÂ£ chÃ¡Â»Ân'
                : count($selectedProductIds) . ' sÃ¡ÂºÂ£n phÃ¡ÂºÂ£m Ä‘ÃƒÂ£ chÃ¡Â»Ân');
        $messageScopeLabel = $productScopeLabel ? "{$scopeLabel}, {$productScopeLabel}" : $scopeLabel;

        return response()->json([
            'resolved_order_ids' => array_map(fn (array $order) => (int) $order['id'], $resolvedOrders),
            'resolved_orders' => $resolvedOrders,
            'missing_codes' => $missingCodes,
            'duplicate_codes' => $duplicateCodes,
            'summary' => [
                'submitted_count' => $preparedCodes->count(),
                'matched_count' => count($resolvedOrders),
                'missing_count' => count($missingCodes),
                'duplicate_count' => count($duplicateCodes),
            ],
        ]);
    }

    public function inventorySlips(Request $request, int $id)
    {
        $order = $this->findScopedOrder($request, $id);

        return response()->json(
            $this->orderInventorySlipService->getOrderDetail($order)
        );
    }

    public function storeInventorySlip(Request $request, int $id)
    {
        $order = $this->findScopedOrder($request, $id);

        $validated = $request->validate([
            'type' => 'required|string|in:export,return,damaged',
            'document_date' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer',
            'items.*.quantity' => 'nullable|integer|min:0',
            'items.*.notes' => 'nullable|string|max:1000',
        ]);

        $document = $this->orderInventorySlipService->createSlip($order, $validated, Auth::id());

        return response()->json($document, 201);
    }

    public function destroyInventorySlip(Request $request, int $id, int $documentId)
    {
        $order = $this->findScopedOrder($request, $id);

        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return response()->json([
                'message' => 'Chỉ đơn hàng chính thức mới có phiếu kho.',
            ], 422);
        }

        $this->orderInventorySlipService->deleteSlip($order, $documentId);

        return response()->json([
            'message' => 'Đã xóa phiếu kho của đơn hàng.',
        ]);
    }

    public function previewBatchReturn(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|distinct',
        ]);

        return response()->json(
            $this->orderInventorySlipService->previewBatchReturn($validated['order_ids'], $accountId)
        );
    }

    public function storeBatchReturn(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|distinct',
            'document_date' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'nullable|integer|min:0',
            'items.*.notes' => 'nullable|string|max:1000',
        ]);

        return response()->json(
            $this->orderInventorySlipService->createBatchReturn($validated, $accountId, Auth::id()),
            201
        );
    }

    public function showBatchReturn(Request $request, int $documentId)
    {
        $accountId = $this->resolveAccountId($request);
        $document = InventoryDocument::query()
            ->where('type', 'return')
            ->when($accountId > 0, fn ($query) => $query->where('account_id', $accountId))
            ->findOrFail($documentId);

        return response()->json(
            $this->orderInventorySlipService->getManagedReturnDocumentPayload($document)
        );
    }

    public function updateBatchReturn(Request $request, int $documentId)
    {
        $accountId = $this->resolveAccountId($request);
        $document = InventoryDocument::query()
            ->where('type', 'return')
            ->when($accountId > 0, fn ($query) => $query->where('account_id', $accountId))
            ->findOrFail($documentId);

        $validated = $request->validate([
            'document_date' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'nullable|integer|min:0',
            'items.*.notes' => 'nullable|string|max:1000',
        ]);

        return response()->json(
            $this->orderInventorySlipService->updateManagedReturnDocument($document, $validated, Auth::id())
        );
    }

    public function store(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'lead_id' => 'nullable|integer|exists:leads,id',
            'order_kind' => 'nullable|string|in:official,template,draft',
            'order_type' => 'nullable|string|in:standard,exchange_return,partial_delivery',
            'region_type' => 'nullable|string|in:new,old',
            'settlement_delta' => 'nullable|numeric',
            'return_tracking_code' => 'nullable|string|max:120',
            'return_status' => 'nullable|string|in:not_returned,returned',
            'supplement_items' => 'nullable|array',
            'supplement_items.*.product_id' => 'nullable|integer',
            'supplement_items.*.quantity' => 'nullable|integer|min:0',
            'supplement_items.*.price' => 'nullable|numeric',
            'supplement_items.*.cost_price' => 'nullable|numeric',
            'supplement_items.*.notes' => 'nullable|string|max:2000',
        ]);

        $orderKind = $this->normalizeOrderKind($validated['order_kind'] ?? null);
        $orderType = $this->normalizeOrderType($validated['order_type'] ?? null);
        $regionType = (string) ($validated['region_type'] ?? 'new');
        $hasSupplementItems = collect((array) $request->input('supplement_items', []))
            ->contains(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']));

        $this->ensureRequestedOrderSchemaSupport($orderKind, $orderType, $hasSupplementItems);

        if ($this->requiresOfficialValidation($orderKind)) {
            $this->validateOfficialOrderPayload($request->all(), $regionType);
        } elseif ($this->allowsEmptyItems($orderKind)) {
            $this->validateDraftOrderPayload($request->all());
        }

        $rawItems = $this->collectRequestItems($request, $this->allowsEmptyItems($orderKind));

        return $this->runOrderNumberMutation($orderKind, function () use ($request, $accountId, $rawItems, $orderKind, $orderType) {
            return DB::transaction(function () use ($request, $accountId, $rawItems, $orderKind, $orderType) {
                $recordedAt = now();
                $lead = null;
            if ($request->filled('lead_id')) {
                $lead = \App\Models\Lead::query()
                    ->where('account_id', $accountId)
                    ->with('statusConfig')
                    ->findOrFail((int) $request->lead_id);
            }

            $returnTrackingData = $this->supplementReturnTrackingPayload(
                $orderType,
                $request->input('return_tracking_code'),
                $request->input('return_status')
            );
            $persistedTextFields = $this->normalizePersistedOrderTextFields([
                'customer_name' => $request->input('customer_name'),
                'customer_email' => $request->input('customer_email'),
                'customer_phone' => $request->input('customer_phone'),
                'shipping_address' => $request->input('shipping_address'),
            ]);

            $order = Order::create($this->filterPersistableOrderData(array_merge([
                'user_id' => Auth::id(),
                'account_id' => $accountId,
                'lead_id' => $lead?->id,
                'order_number' => $this->generateOrderNumber($orderKind),
                'order_kind' => $orderKind,
                'order_type' => $orderType,
                'total_price' => 0,
                'status' => $request->status ?? $this->defaultStatusForKind($accountId, $orderKind),
                'customer_name' => $persistedTextFields['customer_name'],
                'customer_email' => $persistedTextFields['customer_email'],
                'customer_phone' => $persistedTextFields['customer_phone'],
                'shipping_address' => $persistedTextFields['shipping_address'],
                'province' => $request->province,
                'district' => $request->district,
                'ward' => $request->ward,
                'notes' => $request->notes,
                'source' => $request->source,
                'type' => $request->type,
                'shipment_status' => $request->shipment_status,
                'shipping_fee' => $request->shipping_fee ?? 0,
                'discount' => $request->discount ?? 0,
                'settlement_delta' => $orderType === self::ORDER_TYPE_STANDARD ? 0 : (float) ($request->settlement_delta ?? 0),
                'cost_total' => 0,
                'profit_total' => 0,
                'supplement_items_total_price' => 0,
                'supplement_items_cost_total' => 0,
                'report_revenue_total' => 0,
                'report_cost_total' => 0,
                'report_profit_total' => 0,
            ], $this->freshShippingState(), $returnTrackingData, $this->initialOrderKindTimestampPayload($orderKind, $recordedAt))));

            $summary = $this->syncOrderItems(
                $order,
                $rawItems,
                $orderKind,
                $this->shouldManageInventory($orderKind)
            );
            $supplementSummary = $orderType === self::ORDER_TYPE_STANDARD
                ? $this->syncSupplementItems($order, [])
                : $this->syncSupplementItems($order, (array) $request->input('supplement_items', []));
            $this->recalculateOrderTotals(
                $order,
                (float) ($summary['total_price'] ?? 0),
                (float) ($summary['cost_total'] ?? 0),
                $orderType,
                (float) ($request->input('settlement_delta', 0) ?? 0),
                (float) ($supplementSummary['total_price'] ?? 0),
                (float) ($supplementSummary['cost_total'] ?? 0)
            );
            $this->syncOrderAttributes($order, (array) $request->input('custom_attributes', []));

            if ($this->shouldManageInventory($orderKind)) {
                $this->syncOfficialCustomerAndInvoice($order, true);
            }

            if (!$request->has('items')) {
                Cart::where('user_id', Auth::id())->first()?->items()->delete();
            }

            if ($lead && $this->shouldManageInventory($orderKind)) {
                $createdStatus = \App\Models\LeadStatus::query()
                    ->where('account_id', $accountId)
                    ->where('code', 'da-tao-don')
                    ->first();

                $lead->update([
                    'order_id' => $order->id,
                    'lead_status_id' => $createdStatus?->id ?? $lead->lead_status_id,
                    'status' => $createdStatus?->code ?? 'da-tao-don',
                    'status_changed_at' => now(),
                ]);

                \App\Models\LeadNote::create([
                    'account_id' => $accountId,
                    'lead_id' => $lead->id,
                    'user_id' => Auth::id(),
                    'staff_name' => Auth::user()?->name ?? 'Nhân viên',
                    'content' => 'Đã tạo đơn hàng ' . $order->order_number,
                ]);

                $lead->forceFill([
                    'latest_note_excerpt' => 'Đã tạo đơn hàng ' . $order->order_number,
                    'last_noted_at' => now(),
                ])->save();
            }

                return response()->json($this->mutationResponsePayload($order), 201);
            });
        });
    }


    public function show(Request $request, $id)
    {
        $order = $this->scopedOrderQuery($request)
            ->select($this->selectExistingOrderColumns([
                'id',
                'user_id',
                'account_id',
                'lead_id',
                'order_number',
                'order_kind',
                'order_type',
                'converted_from_order_id',
                'converted_from_kind',
                'total_price',
                'status',
                'customer_name',
                'customer_email',
                'customer_phone',
                'shipping_address',
                'province',
                'district',
                'ward',
                'notes',
                'source',
                'type',
                'shipment_status',
                'shipping_fee',
                'internal_shipping_fee',
                'discount',
                'settlement_delta',
                'return_tracking_code',
                'return_status',
                'cost_total',
                'profit_total',
                'print_count',
                'last_printed_at',
                'supplement_items_total_price',
                'supplement_items_cost_total',
                'report_revenue_total',
                'report_cost_total',
                'report_profit_total',
                'external_delivery_meta',
                'created_at',
                'draft_created_at',
                'officialized_at',
                'updated_at',
            ]))
            ->addSelect($this->orderDisplayTimestampSelect('orders'))
            ->with($this->orderDetailRelations())
            ->findOrFail((int) $id);

        $this->appendCurrentCostMetrics($order);
        $this->attachResolvedInternalShippingFee($order);
        $order->setAttribute('draft_created_at', $this->resolveOrderDraftCreatedAt($order));
        $order->setAttribute('officialized_at', $this->resolveOrderOfficializedAt($order));
        $order->setAttribute('displayed_at', $this->resolveOrderDisplayedAt($order));

        return response()->json($order);
    }

    public function printData(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào để in.'], 400);
        }

        $positions = $ids->flip();

        if (false && $shipmentsPayload->contains(
            fn (array $item) => $item['dispatch_mode'] === self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY
                && !$item['external_delivery_type']
        )) {
            return response()->json([
                'message' => 'Cần chọn hình thức gửi ngoài cho các đơn dùng luồng Gửi ngoài.',
            ], 422);
        }

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->select([
                'id',
                'order_number',
                'customer_name',
                'customer_phone',
                'shipping_address',
                'province',
                'district',
                'ward',
                'notes',
                'total_price',
                'created_at',
                'draft_created_at',
                'officialized_at',
                'order_kind',
            ])
            ->with($this->orderPrintRelations())
            ->get()
            ->sortBy(fn (Order $order) => $positions->get((int) $order->id, PHP_INT_MAX))
            ->values();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng để in.'], 404);
        }

        return response()->json([
            'data' => $this->transformPrintableOrders($orders),
        ]);
    }

    private function persistOrderMutation(Order $order, Request $request, ?string $forcedTargetKind = null): Order
    {
        $requestedKind = $this->normalizeOrderKind($forcedTargetKind ?? $request->input('order_kind', $order->order_kind));
        $requestedOrderType = $this->normalizeOrderType($request->input('order_type', $order->order_type));
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);
        $hasSupplementItems = collect((array) $request->input('supplement_items', []))
            ->contains(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']));

        $this->ensureRequestedOrderSchemaSupport($requestedKind, $requestedOrderType, $hasSupplementItems);

        if ($this->requiresOfficialValidation($requestedKind)) {
            $this->validateOfficialOrderPayload([
                'province' => $request->input('province', $order->province),
                'district' => $request->input('district', $order->district),
                'ward' => $request->input('ward', $order->ward),
                'shipping_address' => $request->input('shipping_address', $order->shipping_address),
            ], (string) $request->input('region_type', 'new'));
        } elseif ($this->allowsEmptyItems($requestedKind)) {
            $this->validateDraftOrderPayload([
                'customer_name' => $request->input('customer_name', $order->customer_name),
                'customer_phone' => $request->input('customer_phone', $order->customer_phone),
            ]);
        }

        $data = $this->normalizePersistedOrderTextFields($request->only([
            'order_number', 'customer_name', 'customer_email', 'customer_phone',
            'shipping_address', 'province', 'district', 'ward', 'notes', 'source',
            'type', 'shipment_status', 'shipping_fee', 'discount', 'status'
        ]));
        $data['order_type'] = $requestedOrderType;
        $data['settlement_delta'] = $requestedOrderType === self::ORDER_TYPE_STANDARD
            ? 0
            : (float) $request->input('settlement_delta', $order->settlement_delta ?? 0);
        $data = array_merge(
            $data,
            $this->supplementReturnTrackingPayload(
                $requestedOrderType,
                $request->input('return_tracking_code', $order->return_tracking_code),
                $request->input('return_status', $order->return_status)
            )
        );

        if (!$this->shouldManageInventory($requestedKind)) {
            $data = array_merge($data, $this->freshShippingState());
        } elseif (!$order->hasActiveShipment() && blank($order->shipping_status_source)) {
            $data['shipping_status_source'] = self::SHIPPING_STATUS_SOURCE_MANUAL;
        }

        $data = $this->filterPersistableOrderData($data);

        $order->update($data);

        if ($request->has('items')) {
            if ($this->shouldManageInventory($currentKind)) {
                $this->releaseInventoryIfNeeded($order->forceFill(['order_kind' => $currentKind]));
            }
            $order->items()->delete();
            $itemSyncKind = $this->shouldManageInventory($requestedKind) && !$this->shouldManageInventory($currentKind)
                ? $currentKind
                : $requestedKind;
            $inventorySummary = $this->syncOrderItems(
                $order,
                (array) $request->input('items', []),
                $itemSyncKind,
                $this->shouldManageInventory($itemSyncKind)
            );
            $itemRevenue = $inventorySummary['total_price'];
            $costTotal = $inventorySummary['cost_total'];
        } else {
            $itemRevenue = (float) $order->items()->sum(DB::raw('price * quantity'));
            $costTotal = (float) $order->items()->sum('cost_total');
        }

        $supplementSummary = $request->has('supplement_items') || $requestedOrderType === self::ORDER_TYPE_STANDARD
            ? $this->syncSupplementItems(
                $order,
                $requestedOrderType === self::ORDER_TYPE_STANDARD
                    ? []
                    : (array) $request->input('supplement_items', [])
            )
            : [
                'total_price' => (float) ($order->supplement_items_total_price ?? 0),
                'cost_total' => (float) ($order->supplement_items_cost_total ?? 0),
            ];

        $this->recalculateOrderTotals(
            $order,
            (float) $itemRevenue,
            (float) $costTotal,
            $requestedOrderType,
            (float) $data['settlement_delta'],
            (float) ($supplementSummary['total_price'] ?? 0),
            (float) ($supplementSummary['cost_total'] ?? 0)
        );

        if ($request->has('custom_attributes')) {
            $this->syncOrderAttributes($order, (array) $request->input('custom_attributes', []));
        }

        if ($currentKind !== $requestedKind) {
            $order = $this->convertOrderToKind($order->fresh(['items', 'attributeValues']), $requestedKind, [
                'province' => $request->input('province', $order->province),
                'district' => $request->input('district', $order->district),
                'ward' => $request->input('ward', $order->ward),
                'shipping_address' => $request->input('shipping_address', $order->shipping_address),
                'region_type' => $request->input('region_type', 'new'),
            ]);
        } elseif ($this->shouldManageInventory($requestedKind)) {
            $this->syncOfficialCustomerAndInvoice($order, false);
        }

        $this->syncActiveShipmentFinancials($order);

        return $order;
    }

    public function update(Request $request, $id)
    {
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'order_number' => 'sometimes|string|max:255',
            'customer_name' => 'sometimes|string|max:255',
            'customer_email' => 'nullable|max:255',
            'customer_phone' => 'nullable|string|max:20',
            'shipping_address' => 'nullable|string',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'notes' => 'nullable|string',
            'custom_attributes' => 'nullable|array',
            'order_kind' => 'nullable|string|in:official,template,draft',
            'order_type' => 'nullable|string|in:standard,exchange_return,partial_delivery',
            'region_type' => 'nullable|string|in:new,old',
            'settlement_delta' => 'nullable|numeric',
            'return_tracking_code' => 'nullable|string|max:120',
            'return_status' => 'nullable|string|in:not_returned,returned',
            'supplement_items' => 'nullable|array',
            'supplement_items.*.product_id' => 'nullable|integer',
            'supplement_items.*.quantity' => 'nullable|integer|min:0',
            'supplement_items.*.price' => 'nullable|numeric',
            'supplement_items.*.cost_price' => 'nullable|numeric',
            'supplement_items.*.notes' => 'nullable|string|max:2000',
        ]);

        if ($validator->fails()) {
            \Illuminate\Support\Facades\Log::error('Order Update Validation Failed', [
                'errors' => $validator->errors()->toArray(),
                'request_data' => $request->all()
            ]);
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $order = $this->findScopedOrder($request, (int) $id);
        $accountId = $order->account_id;

        // Check unique order_number if provided
        if ($request->has('order_number') && $request->order_number !== $order->order_number) {
            $exists = Order::withTrashed()
                ->where('order_number', $request->order_number)
                ->where('id', '!=', $id)
                ->exists();
            if ($exists) {
                return response()->json(['message' => 'Mã đơn hàng này đã tồn tại trong hệ thống!'], 422);
            }
        }

        return DB::transaction(function () use ($request, $order) {
            return response()->json($this->mutationResponsePayload(
                $this->persistOrderMutation($order, $request)
            ));
        });
    }

    public function markPrinted(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào để cập nhật in đơn.'], 400);
        }

        $accountId = $this->resolveAccountId($request);
        OrderStatusCatalog::ensurePrintedStatus($accountId);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->select($this->selectExistingOrderColumns([
                'id',
                'status',
                'order_kind',
                'shipping_dispatched_at',
                'print_count',
            ]))
            ->with([
                'activeShipment:id,order_id',
            ])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng để cập nhật trạng thái in.'], 404);
        }

        $updatedIds = [];
        $statusPreservedIds = [];
        $statusIgnoredIds = [];
        $printCounts = [];
        $printedAt = now();

        DB::transaction(function () use ($orders, $printedAt, &$updatedIds, &$statusPreservedIds, &$statusIgnoredIds, &$printCounts) {
            foreach ($orders as $order) {
                $nextPrintCount = max((int) ($order->print_count ?? 0), 0) + 1;
                $updatePayload = [
                    'print_count' => $nextPrintCount,
                    'last_printed_at' => $printedAt,
                ];

                if (!$this->shouldManageInventory((string) $order->order_kind)) {
                    $statusIgnoredIds[] = (int) $order->id;
                    $order->update($updatePayload);
                    $printCounts[(string) $order->id] = $nextPrintCount;
                    continue;
                }

                if (
                    $order->status === OrderStatusCatalog::PRINTED_CODE
                    || OrderStatusCatalog::shouldKeepStatusWhenPrinting($order->status)
                    || $order->shipping_dispatched_at
                    || $order->activeShipment
                ) {
                    $statusPreservedIds[] = (int) $order->id;
                    $order->update($updatePayload);
                    $printCounts[(string) $order->id] = $nextPrintCount;
                    continue;
                }

                \App\Models\OrderStatusLog::create([
                    'order_id' => $order->id,
                    'from_status' => $order->status,
                    'to_status' => OrderStatusCatalog::PRINTED_CODE,
                    'source' => 'system',
                    'changed_by' => auth()->id(),
                    'reason' => 'Tự động cập nhật sau khi in đơn hàng',
                ]);

                $updatePayload['status'] = OrderStatusCatalog::PRINTED_CODE;
                $order->update($updatePayload);

                $updatedIds[] = (int) $order->id;
                $printCounts[(string) $order->id] = $nextPrintCount;
            }
        });

        return response()->json([
            'message' => 'Đã ghi nhận thao tác in đơn.',
            'recorded_count' => count($printCounts),
            'updated_count' => count($updatedIds),
            'preserved_count' => count($statusPreservedIds),
            'ignored_count' => count($statusIgnoredIds),
            'updated_ids' => $updatedIds,
            'preserved_ids' => $statusPreservedIds,
            'ignored_ids' => $statusIgnoredIds,
            'print_counts' => $printCounts,
        ]);
    }

    public function destroy(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        if ($order->trashed()) {
            return response()->json(['message' => 'Đơn hàng đã ở trong thùng rác.'], 422);
        }

        DB::transaction(function () use ($order) {
            $this->releaseInventoryIfNeeded($order);
            $order->delete();
        });

        return response()->json(['message' => 'Đã chuyển đơn hàng vào thùng rác.']);
    }

    public function forceDelete(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        DB::transaction(function () use ($order) {
            if (!$order->trashed()) {
                $this->releaseInventoryIfNeeded($order);
            }

            $order->forceDelete();
        });

        return response()->json(['message' => 'Đã xóa vĩnh viễn đơn hàng.']);
    }

    public function duplicate(Request $request, $id)
    {
        $original = $this->scopedOrderQuery($request, true)
            ->with($this->orderSupplementItemsTableExists()
                ? ['items', 'attributeValues', 'supplementItems']
                : ['items', 'attributeValues'])
            ->findOrFail($id);
        $targetKind = $this->normalizeOrderKind($request->input('target_kind', self::ORDER_KIND_DRAFT));

        return response()->json(
            $this->mutationResponsePayload(
                $this->duplicateOrderToKind($original, $targetKind)
            )
        );
    }

    public function convert(Request $request, $id)
    {
        $request->validate([
            'target_kind' => 'required|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'shipping_address' => 'nullable|string',
        ]);

        $order = $this->scopedOrderQuery($request)
            ->with(['items', 'attributeValues', 'shipments', 'inventoryDocuments'])
            ->findOrFail($id);
        $targetKind = $this->normalizeOrderKind((string) $request->input('target_kind'));
        $this->guardConvertOrderKind($order, $targetKind);

        return DB::transaction(function () use ($request, $order, $targetKind) {
            return response()->json($this->mutationResponsePayload(
                $this->persistOrderMutation($order, $request, $targetKind)
            ));
        });
    }

    public function updateStatus(Request $request, $id)
    {
        try {
            $request->validate([
                'status' => 'required|string',
                'allow_shipping_override' => 'nullable|boolean',
            ]);

            return DB::transaction(function () use ($request, $id) {
                $order = $this->findScopedOrder($request, (int) $id);

                if (!$this->shouldManageInventory((string) $order->order_kind)) {
                    return response()->json([
                        'message' => 'Đơn mẫu và đơn nháp không hỗ trợ cập nhật trạng thái giao hàng.',
                    ], 422);
                }

                $newStatus = $request->status;
                $oldStatus = $order->status;

                if ($newStatus === $oldStatus) {
                    return response()->json($order->load(array_merge(
                        $this->orderDetailRelations(),
                        ['customer', 'shipments']
                    )));
                }

                // Validate that the status exists in order_statuses for this account
                $exists = \App\Models\OrderStatus::where('account_id', $order->account_id)
                    ->where('code', $newStatus)
                    ->exists();

                if (!$exists) {
                    return response()->json(['message' => "Trạng thái '{$newStatus}' không hợp lệ cho hệ thống của bạn."], 422);
                }

                // Check if shipping-related statuses are locked by active shipment
                $shippingLockedStatuses = [
                    'shipping',
                    'completed',
                    'pending_return',
                    'returned',
                    OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
                    OrderStatusCatalog::PARTIAL_DELIVERY_CODE,
                ];
                $allowShippingOverride = $request->boolean('allow_shipping_override');
                if (in_array($newStatus, $shippingLockedStatuses, true) && $order->hasActiveShipment()) {
                    $syncService = app(ShipmentStatusSyncService::class);
                    $canEdit = $syncService->canManuallyEditOrderShipping($order);

                    if (!$allowShippingOverride && !$canEdit['allowed']) {
                        return response()->json([
                            'message' => $canEdit['reason'],
                            'shipping_locked' => true,
                            'shipment_number' => $canEdit['shipment_number'] ?? null,
                        ], 422);
                    }

                    if ($allowShippingOverride) {
                        $activeShipment = $order->activeShipment()->first();
                        $targetShipmentStatus = app(CarrierStatusMapper::class)->inferShipmentStatusFromOrderStatus(
                            $newStatus,
                            $order->account_id
                        );

                        if ($activeShipment && $targetShipmentStatus !== null) {
                            $shipmentResult = $syncService->updateShipmentStatus(
                                $activeShipment,
                                $targetShipmentStatus,
                                'manual',
                                auth()->id(),
                                $request->reason ?? 'Cập nhật từ trạng thái đơn hàng',
                                null,
                                (bool) (auth()->user()?->is_admin ?? false)
                            );

                            if (!($shipmentResult['success'] ?? false)) {
                                return response()->json([
                                    'message' => $shipmentResult['message'] ?? 'Không thể đồng bộ trạng thái vận đơn.',
                                    'requires_override' => (bool) ($shipmentResult['requires_override'] ?? false),
                                    'shipping_locked' => true,
                                    'shipment_number' => $activeShipment->shipment_number,
                                ], 422);
                            }

                            $order->refresh();

                            if ((string) $order->status === (string) $newStatus) {
                                return response()->json($order->load(array_merge(
                                    $this->orderDetailRelations(),
                                    ['customer', 'shipments']
                                )));
                            }
                        }
                    }
                }

                // Log order status change
                \App\Models\OrderStatusLog::create([
                    'order_id'    => $order->id,
                    'from_status' => $oldStatus,
                    'to_status'   => $newStatus,
                    'source'      => 'manual',
                    'changed_by'  => auth()->id(),
                    'reason'      => $request->reason ?? 'Cập nhật nhanh từ danh sách',
                ]);

                $order->update(['status' => $newStatus]);

                return response()->json($order->load(array_merge(
                    $this->orderDetailRelations(),
                    ['customer', 'shipments']
                )));
            });
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json(['errors' => $e->errors(), 'message' => 'Dữ liệu không hợp lệ'], 422);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Order Status Update Error for ID {$id}: " . $e->getMessage());
            return response()->json(['message' => 'Có lỗi xảy ra: ' . $e->getMessage()], 500);
        }
    }

    public function restore(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        if (!$order->trashed()) {
            return response()->json(['message' => 'Đơn hàng đang hoạt động.'], 422);
        }

        DB::transaction(function () use ($order) {
            $order->restore();
            $inventorySummary = $this->reserveInventoryIfNeeded($order->fresh(['items']));

            $this->recalculateOrderTotals(
                $order,
                (float) ($inventorySummary['total_price'] ?? 0),
                (float) ($inventorySummary['cost_total'] ?? 0)
            );
        });

        return response()->json(['message' => 'Đã khôi phục đơn hàng.']);
    }

    public function bulkDelete(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);
        }

        $orders = $this->scopedOrderQuery($request, true)
            ->whereIn('id', $ids->all())
            ->with(['items'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng nào theo danh sách đã chọn.'], 404);
        }

        $forceDelete = $request->boolean('force');

        DB::transaction(function () use ($orders, $forceDelete) {
            foreach ($orders as $order) {
                if ($forceDelete) {
                    if (!$order->trashed()) {
                        $this->releaseInventoryIfNeeded($order);
                    }

                    $order->forceDelete();
                    continue;
                }

                if ($order->trashed()) {
                    continue;
                }

                $this->releaseInventoryIfNeeded($order);
                $order->delete();
            }
        });

        return response()->json([
            'message' => $forceDelete
                ? 'Đã xóa vĩnh viễn các đơn hàng đã chọn.'
                : 'Đã chuyển các đơn hàng đã chọn vào thùng rác.',
        ]);
    }

    public function bulkRestore(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);
        }

        $orders = $this->scopedOrderQuery($request, true)
            ->whereIn('id', $ids->all())
            ->with(['items'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng nào theo danh sách đã chọn.'], 404);
        }

        DB::transaction(function () use ($orders) {
            foreach ($orders as $order) {
                if (!$order->trashed()) {
                    continue;
                }

                $order->restore();
                $inventorySummary = $this->reserveInventoryIfNeeded($order->fresh(['items']));
                $this->recalculateOrderTotals(
                    $order,
                    (float) ($inventorySummary['total_price'] ?? 0),
                    (float) ($inventorySummary['cost_total'] ?? 0)
                );
            }
        });

        return response()->json(['message' => 'Đã khôi phục các đơn hàng đã chọn.']);
    }

    public function bulkDuplicate(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);
        }

        $duplicatedCount = 0;
        DB::transaction(function () use ($request, $ids, &$duplicatedCount) {
            foreach ($ids as $id) {
                $original = $this->scopedOrderQuery($request, true)
                    ->with($this->orderSupplementItemsTableExists()
                        ? ['items', 'attributeValues', 'supplementItems']
                        : ['items', 'attributeValues'])
                    ->find($id);

                if (!$original) {
                    continue;
                }

                $targetKind = $this->normalizeOrderKind($request->input('target_kind', self::ORDER_KIND_DRAFT));
                $this->duplicateOrderToKind($original, $targetKind);

                $duplicatedCount++;
            }
        });

        return response()->json(['message' => "Đã sao chép {$duplicatedCount} đơn hàng thành công."]);
    }

    public function bulkConvert(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'target_kind' => 'required|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'shipping_address' => 'nullable|string',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->with(['items', 'attributeValues', 'shipments', 'inventoryDocuments'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng nào theo danh sách đã chọn.'], 404);
        }

        $convertedCount = 0;
        DB::transaction(function () use ($orders, $validated, &$convertedCount) {
            foreach ($orders as $order) {
                $this->convertOrderToKind($order, $validated['target_kind'], $validated);
                $convertedCount++;
            }
        });

        return response()->json([
            'message' => "Đã chuyển nhóm {$convertedCount} đơn hàng thành công.",
        ]);
    }

    public function bulkUpdate(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($ids)) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);
        }

        $data = $request->only([
            'status', 'notes', 'source', 'type', 'shipment_status'
        ]);

        $customAttributes = $request->input('custom_attributes', []);

        DB::transaction(function () use ($request, $ids, $data, $customAttributes) {
            if (!empty($data)) {
                $this->scopedOrderQuery($request)->whereIn('id', $ids)->update($data);
            }

            if (!empty($customAttributes)) {
                foreach ($ids as $orderId) {
                    foreach ($customAttributes as $attrId => $val) {
                        \App\Models\OrderAttributeValue::updateOrCreate(
                            ['order_id' => $orderId, 'attribute_id' => $attrId],
                            ['value' => is_array($val) ? json_encode($val) : $val]
                        );
                    }
                }
            }
        });

        return response()->json(['message' => 'Cập nhật hàng loạt thành công.']);
    }

    public function refreshImportCosts(Request $request)
    {
        $validated = $request->validate([
            'all_history' => 'nullable|boolean',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'product_ids' => 'nullable|array|min:1',
            'product_ids.*' => 'integer|distinct|exists:products,id',
        ]);

        $allHistory = (bool) ($validated['all_history'] ?? false);
        $dateFrom = !empty($validated['date_from']) ? (string) $validated['date_from'] : null;
        $dateTo = !empty($validated['date_to']) ? (string) $validated['date_to'] : null;
        $selectedProductIds = collect($validated['product_ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $refreshProductIds = $this->expandRefreshImportCostProductIds($selectedProductIds);

        if (!$allHistory && !$dateFrom && !$dateTo) {
            throw ValidationException::withMessages([
                'date_from' => 'Vui lÃ²ng chá»n khoáº£ng ngÃ y hoáº·c báº­t cáº­p nháº­t toÃ n bá»™ lá»‹ch sá»­.',
            ]);
        }

        if ($dateFrom && $dateTo && Carbon::parse($dateFrom)->gt(Carbon::parse($dateTo))) {
            throw ValidationException::withMessages([
                'date_to' => 'NgÃ y káº¿t thÃºc pháº£i lá»›n hÆ¡n hoáº·c báº±ng ngÃ y báº¯t Ä‘áº§u.',
            ]);
        }

        $baseQuery = $this->scopedOrderQuery($request)
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });

        if (!$allHistory && $dateFrom) {
            $this->applyOrderDisplayDateFilter($baseQuery, '>=', $dateFrom);
        }

        if (!$allHistory && $dateTo) {
            $this->applyOrderDisplayDateFilter($baseQuery, '<=', $dateTo);
        }

        if (!empty($refreshProductIds)) {
            $baseQuery->where(function ($query) use ($refreshProductIds) {
                $query->whereHas('items', function ($itemQuery) use ($refreshProductIds) {
                    $itemQuery->where(function ($matchQuery) use ($refreshProductIds) {
                        $matchQuery
                            ->whereIn('product_id', $refreshProductIds)
                            ->orWhereIn('actual_product_id', $refreshProductIds);
                    });
                });

                if ($this->orderSupplementItemsTableExists()) {
                    $query->orWhereHas('supplementItems', function ($itemQuery) use ($refreshProductIds) {
                        $itemQuery->whereIn('product_id', $refreshProductIds);
                    });
                }
            });
        }

        $matchedOrders = (clone $baseQuery)->count();

        if ($matchedOrders === 0) {
            return response()->json([
                'message' => 'KhÃ´ng cÃ³ Ä‘Æ¡n chÃ­nh nÃ o khá»›p pháº¡m vi cáº­p nháº­t.',
                'matched_orders' => 0,
                'updated_orders' => 0,
                'updated_items' => 0,
                'updated_supplement_items' => 0,
            ]);
        }

        $updatedOrders = 0;
        $updatedItems = 0;
        $updatedSupplementItems = 0;

        (clone $baseQuery)
            ->select('id')
            ->orderBy('id')
            ->chunkById(50, function ($chunk) use (
                $request,
                $refreshProductIds,
                &$updatedOrders,
                &$updatedItems,
                &$updatedSupplementItems
            ) {
                $orderIds = $chunk->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->filter()
                    ->values()
                    ->all();

                if (empty($orderIds)) {
                    return;
                }

                $relations = ['items.product', 'items.actualProduct'];
                if ($this->orderSupplementItemsTableExists()) {
                    $relations[] = 'supplementItems.product';
                }

                $orders = $this->scopedOrderQuery($request)
                    ->whereIn('id', $orderIds)
                    ->with($relations)
                    ->orderBy('id')
                    ->get();

                foreach ($orders as $order) {
                    DB::transaction(function () use (
                        $order,
                        $refreshProductIds,
                        &$updatedOrders,
                        &$updatedItems,
                        &$updatedSupplementItems
                    ) {
                        $summary = $this->refreshOrderImportCostSnapshots($order, $refreshProductIds);

                        $updatedOrders++;
                        $updatedItems += (int) ($summary['updated_items'] ?? 0);
                        $updatedSupplementItems += (int) ($summary['updated_supplement_items'] ?? 0);
                    });
                }
            }, 'id');

        $scopeLabel = $allHistory
            ? 'toÃ n bá»™ lá»‹ch sá»­'
            : trim(collect([$dateFrom ?: '...', $dateTo ?: '...'])->implode(' â†’ '));

        return response()->json([
            'message' => "ÄÃ£ cáº­p nháº­t giÃ¡ nháº­p cho {$updatedOrders} Ä‘Æ¡n ({$scopeLabel}).",
            'matched_orders' => $matchedOrders,
            'updated_orders' => $updatedOrders,
            'updated_items' => $updatedItems,
            'updated_supplement_items' => $updatedSupplementItems,
        ]);
    }

    public function dispatchPreview(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
            'carrier_code' => 'required|string|max:50',
            'warehouse_id' => 'nullable|integer|exists:warehouses,id',
        ]);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $validated['order_ids'])
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng cần gửi vận chuyển.'], 404);
        }

        return response()->json(
            $dispatchService->preview($orders, $validated['carrier_code'], $validated['warehouse_id'] ?? null)
        );
    }

    public function dispatch(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
            'carrier_code' => 'required|string|max:50',
            'warehouse_id' => 'nullable|integer|exists:warehouses,id',
        ]);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $validated['order_ids'])
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng cần gửi vận chuyển.'], 404);
        }

        return response()->json(
            $dispatchService->dispatch(
                $orders,
                $validated['carrier_code'],
                Auth::id(),
                $validated['warehouse_id'] ?? null
            )
        );
    }

    public function cancelDispatch(Request $request, ShipmentRollbackService $rollbackService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
        ]);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $validated['order_ids'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng cần hủy gửi vận chuyển.'], 404);
        }

        return response()->json(
            $rollbackService->cancel($orders, Auth::id())
        );
    }

    public function quickDispatch(Request $request, ShipmentStatusSyncService $syncService)
    {
        $validated = $request->validate([
            'shipments' => 'required|array|min:1',
            'shipments.*.order_id' => 'required|integer',
            'shipments.*.dispatch_mode' => 'nullable|string|in:' . self::QUICK_DISPATCH_MODE_MANUAL_SHIPMENT . ',' . self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY,
            'shipments.*.tracking_number' => 'nullable|string|max:100',
            'shipments.*.carrier_name' => 'nullable|string|max:255',
            'shipments.*.shipping_cost' => 'required|numeric|min:0',
            'shipments.*.external_delivery_type' => 'nullable|string|in:' . implode(',', self::OUTSIDE_DELIVERY_TYPES),
            'shipments.*.external_delivery_contact' => 'nullable|string|max:255',
            'shipments.*.external_note' => 'nullable|string|max:2000',
        ]);

        $shipmentsPayload = collect($validated['shipments'])
            ->map(function (array $item) {
                return [
                    'order_id' => (int) $item['order_id'],
                    'dispatch_mode' => $this->normalizeQuickDispatchMode($item['dispatch_mode'] ?? null),
                    'tracking_number' => trim((string) ($item['tracking_number'] ?? '')),
                    'carrier_name' => trim((string) ($item['carrier_name'] ?? '')),
                    'shipping_cost' => (float) $item['shipping_cost'],
                    'external_delivery_type' => $this->normalizeOutsideDeliveryType($item['external_delivery_type'] ?? null),
                    'external_delivery_contact' => trim((string) ($item['external_delivery_contact'] ?? '')),
                    'external_note' => trim((string) ($item['external_note'] ?? '')),
                ];
            })
            ->values();

        if ($shipmentsPayload->contains(
            fn (array $item) => $item['dispatch_mode'] === self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY
                && !$item['external_delivery_type']
        )) {
            return response()->json([
                'message' => 'Cần chọn hình thức gửi ngoài cho các đơn dùng luồng Gửi ngoài.',
            ], 422);
        }

        if ($shipmentsPayload->contains(
            fn (array $item) => $item['dispatch_mode'] === self::QUICK_DISPATCH_MODE_MANUAL_SHIPMENT
                && ($item['tracking_number'] === '' || $item['carrier_name'] === '')
        )) {
            return response()->json([
                'message' => 'Mã vận đơn và đơn vị vận chuyển không được để trống.',
            ], 422);
        }

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $shipmentsPayload->pluck('order_id')->unique()->values())
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product', 'activeShipment'])
            ->get()
            ->keyBy('id');

        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach ($shipmentsPayload as $shipmentInput) {
            $orderId = $shipmentInput['order_id'];
            $order = $orders->get($orderId);

            if (!$order) {
                $failedCount++;
                $results[] = [
                    'order_id' => $orderId,
                    'order_number' => null,
                    'success' => false,
                    'message' => 'Không tìm thấy đơn hàng để gửi vận chuyển.',
                ];
                continue;
            }

            try {
                if ($shipmentInput['dispatch_mode'] === self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY) {
                    $updatedOrder = $this->createOutsideDispatchForOrder($order, $shipmentInput);

                    $successCount++;
                    $results[] = [
                        'order_id' => $updatedOrder->id,
                        'order_number' => $updatedOrder->order_number,
                        'success' => true,
                        'dispatch_mode' => self::QUICK_DISPATCH_MODE_OUTSIDE_DELIVERY,
                        'shipment_id' => null,
                        'shipment_number' => null,
                        'tracking_number' => $updatedOrder->shipping_tracking_code,
                    ];

                    continue;
                }

                $this->assertOrderCanQuickDispatch($order);
                $shipment = $this->createQuickShipmentForOrder($order, $shipmentInput, $syncService);

                $successCount++;
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'success' => true,
                    'dispatch_mode' => self::QUICK_DISPATCH_MODE_MANUAL_SHIPMENT,
                    'shipment_id' => $shipment->id,
                    'shipment_number' => $shipment->shipment_number,
                    'tracking_number' => $shipment->carrier_tracking_code ?: $shipment->tracking_number,
                ];
            } catch (\Throwable $e) {
                $failedCount++;
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'success' => false,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ], $successCount > 0 && $failedCount === 0 ? 201 : 200);
    }

    public function shippingAlerts(Request $request, ShippingAlertService $shippingAlertService)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 50);
        $alerts = $shippingAlertService->activeAlerts($accountId, $perPage);

        return response()->json([
            'data' => $alerts->items(),
            'total' => $alerts->total(),
            'current_page' => $alerts->currentPage(),
            'last_page' => $alerts->lastPage(),
        ]);
    }

    public function connectedCarriers(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        return response()->json($this->loadConnectedCarriers($accountId));
    }

    public function exportViettelPost(Request $request)
    {
        $validated = $request->validate([
            'ids'        => 'required|array|min:1',
            'ids.*'      => 'integer',
            'goods_name' => 'required|string|max:255',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);
        }

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng hợp lệ.'], 404);
        }

        // Generate the Excel file
        $exportService = app(\App\Services\Shipping\ViettelPostExportService::class);
        $tmpDir  = storage_path('app/tmp');
        if (!is_dir($tmpDir) && !mkdir($tmpDir, 0755, true) && !is_dir($tmpDir)) {
            return response()->json(['message' => 'Không thể tạo thư mục tạm.'], 500);
        }
        $filename   = 'VTP_don_hang_' . now()->format('d_m_Y_His') . '.xlsx';
        $outputPath = $tmpDir . DIRECTORY_SEPARATOR . $filename;

        $exportService->export($orders, $validated['goods_name'], $outputPath);

        // Update order statuses to 'dispatched'
        DB::transaction(function () use ($orders) {
            foreach ($orders as $order) {
                // Only change status if it is 'printed' (Đã in) - don't override shipping/done statuses
                if (in_array($order->status, ['new', 'printed', 'confirmed'], true)) {
                    \App\Models\OrderStatusLog::create([
                        'order_id'    => $order->id,
                        'from_status' => $order->status,
                        'to_status'   => 'dispatched',
                        'source'      => 'system',
                        'changed_by'  => auth()->id(),
                        'reason'      => 'Tự động cập nhật sau khi xuất Excel gửi Viettel Post',
                    ]);
                    $order->update(['status' => 'dispatched']);
                }
            }
        });

        return response()->download($outputPath, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend(true);
    }
}
