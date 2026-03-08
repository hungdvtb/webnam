<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class SyncAIKnowledge extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'ai:sync';
    protected $description = 'Sync product knowledge for AI assistant';

    public function handle()
    {
        $this->info('Starting AI Knowledge Sync...');

        $siteConfig = config('site') ?? []; // Fallback
        $products = \App\Models\Product::with(['category', 'groups'])->get();

        $content = "# KNOWLEDGE BASE: GỐM SỨ ĐẠI THÀNH\n\n";
        $content .= "## THÔNG TIN CỬA HÀNG\n";
        $content .= "- Tên: Gốm Sứ Đại Thành\n";
        $content .= "- Slogan: Tinh Hoa Đất Việt\n";
        $content .= "- Hotline: 0912.345.678\n";
        $content .= "- Địa chỉ: Làng gốm Bát Tràng, Gia Lâm, Hà Nội\n";
        $content .= "- Chuyên: Cung cấp gốm sứ tâm linh, gia dụng, trang trí cao cấp.\n\n";

        $content .= "## DANH SÁCH SẢN PHẨM\n\n";

        foreach ($products as $p) {
            $content .= "### " . $p->name . "\n";
            $content .= "- ID: " . $p->id . "\n";
            $content .= "- SKU: " . $p->sku . "\n";
            $content .= "- Giá hiện tại: " . number_format($p->current_price) . " VNĐ\n";
            $content .= "- Danh mục: " . ($p->category->name ?? 'N/A') . "\n";
            $content .= "- Mô tả: " . strip_tags($p->description) . "\n";
            
            if ($p->type === 'configurable' && $p->groups->count() > 0) {
                $content .= "- Các phiên bản/biến thể: \n";
                foreach ($p->groups as $group) {
                    $content .= "  + " . ($group->name ?: 'Phiên bản') . ": " . number_format($group->price) . " VNĐ\n";
                }
            }
            
            $content .= "- Link: /product/" . $p->id . "\n";
            $content .= "\n";
        }

        \Illuminate\Support\Facades\Storage::disk('local')->put('ai/knowledge.md', $content);

        $this->info('AI Knowledge base updated at storage/app/ai/knowledge.md');
    }
}
