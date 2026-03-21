<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class InventoryImportAttachment extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $appends = ['url'];

    protected $fillable = [
        'account_id',
        'import_id',
        'invoice_analysis_log_id',
        'source_type',
        'disk',
        'file_path',
        'original_name',
        'mime_type',
        'file_size',
        'uploaded_by',
    ];

    public function import()
    {
        return $this->belongsTo(InventoryImport::class, 'import_id');
    }

    public function invoiceAnalysisLog()
    {
        return $this->belongsTo(InventoryInvoiceAnalysisLog::class, 'invoice_analysis_log_id');
    }

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function getUrlAttribute(): ?string
    {
        if (!$this->file_path) {
            return null;
        }

        return Storage::disk($this->disk ?: 'public')->url($this->file_path);
    }
}
