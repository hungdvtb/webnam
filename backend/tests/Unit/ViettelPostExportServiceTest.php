<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Services\Shipping\ViettelPostExportService;
use App\Services\SimpleXlsxService;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use ZipArchive;

class ViettelPostExportServiceTest extends TestCase
{
    public function test_export_writes_viettelpost_number_columns_as_numeric_number_cells(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'vtp-export-');
        if ($path === false) {
            throw new RuntimeException('Unable to create temporary file.');
        }

        $xlsxPath = $path . '.xlsx';
        @unlink($path);

        try {
            $order = new Order([
                'order_number' => 'DH001',
                'customer_name' => 'Nguyen Van A',
                'customer_phone' => '0912345678',
                'shipping_address' => '1 Main',
                'ward' => 'Ward',
                'district' => 'District',
                'province' => 'Province',
                'total_price' => '8500000.00',
                'order_type' => Order::TYPE_STANDARD,
            ]);

            $service = new ViettelPostExportService(new SimpleXlsxService());
            $service->export(new Collection([$order]), 'gom su', $xlsxPath);

            [$worksheetXml, $stylesXml] = $this->readWorkbookParts($xlsxPath);
            $cells = $this->worksheetCells($worksheetXml);
            $styleFormats = $this->styleFormats($stylesXml);

            foreach ([
                'A7' => '1',
                'G7' => '1',
                'H7' => '1000',
                'I7' => '8500000',
                'J7' => '8500000',
            ] as $cellRef => $expectedValue) {
                $this->assertArrayHasKey($cellRef, $cells);
                $this->assertSame('', $cells[$cellRef]['type'], "{$cellRef} must not be inlineStr/text.");
                $this->assertSame('1', $cells[$cellRef]['style'], "{$cellRef} must use the Number style.");
                $this->assertSame('1', $styleFormats[(int) $cells[$cellRef]['style']] ?? null);
                $this->assertSame($expectedValue, $cells[$cellRef]['value']);
                $this->assertMatchesRegularExpression('/^-?\d+$/', $cells[$cellRef]['value']);
            }

            foreach (['P7', 'Q7', 'R7'] as $cellRef) {
                $this->assertArrayHasKey($cellRef, $cells);
                $this->assertSame('', $cells[$cellRef]['type'], "{$cellRef} must not be inlineStr/text.");
                $this->assertSame('1', $cells[$cellRef]['style'], "{$cellRef} must use the Number style.");
                $this->assertSame('', $cells[$cellRef]['value'], "{$cellRef} should stay blank for the template.");
            }
        } finally {
            @unlink($xlsxPath);
        }
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function readWorkbookParts(string $path): array
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            throw new RuntimeException('Unable to open generated workbook.');
        }

        try {
            $worksheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
            $stylesXml = $zip->getFromName('xl/styles.xml');

            if ($worksheetXml === false || $stylesXml === false) {
                throw new RuntimeException('Generated workbook is missing required XML parts.');
            }

            return [$worksheetXml, $stylesXml];
        } finally {
            $zip->close();
        }
    }

    /**
     * @return array<string, array{type: string, style: string, value: string}>
     */
    private function worksheetCells(string $worksheetXml): array
    {
        $dom = new DOMDocument();
        $dom->loadXML($worksheetXml);

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

        $cells = [];
        foreach ($xpath->query('//main:sheetData/main:row/main:c') ?: [] as $cellNode) {
            if (!$cellNode instanceof DOMElement) {
                continue;
            }

            $cellRef = $cellNode->getAttribute('r');
            $cells[$cellRef] = [
                'type' => $cellNode->getAttribute('t'),
                'style' => $cellNode->getAttribute('s'),
                'value' => (string) $xpath->evaluate('string(./main:v)', $cellNode),
            ];
        }

        return $cells;
    }

    /**
     * @return array<int, string>
     */
    private function styleFormats(string $stylesXml): array
    {
        $dom = new DOMDocument();
        $dom->loadXML($stylesXml);

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

        $formats = [];
        foreach ($xpath->query('//main:cellXfs/main:xf') ?: [] as $index => $styleNode) {
            if (!$styleNode instanceof DOMElement) {
                continue;
            }

            $formats[$index] = $styleNode->getAttribute('numFmtId');
        }

        return $formats;
    }
}
