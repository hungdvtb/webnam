<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class ShippingIntegration extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'carrier_code',
        'carrier_name',
        'is_enabled',
        'connection_status',
        'api_base_url',
        'username',
        'password_encrypted',
        'access_token',
        'token_expires_at',
        'sender_name',
        'sender_phone',
        'sender_address',
        'sender_province_id',
        'sender_district_id',
        'sender_ward_id',
        'default_service_code',
        'default_service_add',
        'webhook_url',
        'config_json',
        'last_tested_at',
        'last_error_message',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'token_expires_at' => 'datetime',
        'config_json' => 'json',
        'last_tested_at' => 'datetime',
    ];

    public function carrier()
    {
        return $this->belongsTo(Carrier::class, 'carrier_code', 'code');
    }

    public function shipments()
    {
        return $this->hasMany(Shipment::class, 'integration_id');
    }
}
