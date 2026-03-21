<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class InventoryInvoiceAnalysisLog extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'supplier_id',
        'import_id',
        'source_name',
        'disk',
        'file_path',
        'mime_type',
        'file_size',
        'status',
        'provider',
        'extracted_text',
        'analysis_result',
        'error_message',
        'created_by',
    ];

    protected $casts = [
        'analysis_result' => 'array',
    ];

    protected $appends = ['file_url'];

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function import()
    {
        return $this->belongsTo(InventoryImport::class, 'import_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function attachments()
    {
        return $this->hasMany(InventoryImportAttachment::class, 'invoice_analysis_log_id');
    }

    public function getFileUrlAttribute(): ?string
    {
        if (!$this->file_path) {
            return null;
        }

        return Storage::disk($this->disk ?: 'public')->url($this->file_path);
    }
}
