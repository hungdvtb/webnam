<?php

namespace App\Support;

use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

class SimpleXlsx
{
    private const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
    private const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    private const DOC_PROPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
    private const VTYPES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
    private const CORE_PROPS_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
    private const DCTERMS_NS = 'http://purl.org/dc/terms/';
    private const DC_NS = 'http://purl.org/dc/elements/1.1/';
    private const DCMITYPE_NS = 'http://purl.org/dc/dcmitype/';
    private const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
    private const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    private const OFFICE_DOC_RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    public static function buildWorkbook(array $sheets): string
    {
        if (empty($sheets)) {
            throw new RuntimeException('Workbook requires at least one sheet.');
        }

        $normalizedSheets = array_values(array_map(
            fn (array $sheet, int $index) => [
                'name' => self::sanitizeSheetName((string) ($sheet['name'] ?? ('Sheet ' . ($index + 1)))),
                'rows' => array_values($sheet['rows'] ?? []),
            ],
            $sheets,
            array_keys($sheets)
        ));

        $tempPath = tempnam(sys_get_temp_dir(), 'xlsx_');
        if ($tempPath === false) {
            throw new RuntimeException('Unable to allocate a temporary file for Excel export.');
        }

        $zip = new ZipArchive();
        if ($zip->open($tempPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            @unlink($tempPath);
            throw new RuntimeException('Unable to create Excel archive.');
        }

        $zip->addFromString('[Content_Types].xml', self::buildContentTypesXml(count($normalizedSheets)));
        $zip->addFromString('_rels/.rels', self::buildPackageRelationshipsXml());
        $zip->addFromString('docProps/app.xml', self::buildAppPropertiesXml($normalizedSheets));
        $zip->addFromString('docProps/core.xml', self::buildCorePropertiesXml());
        $zip->addFromString('xl/workbook.xml', self::buildWorkbookXml($normalizedSheets));
        $zip->addFromString('xl/_rels/workbook.xml.rels', self::buildWorkbookRelationshipsXml(count($normalizedSheets)));
        $zip->addFromString('xl/styles.xml', self::buildStylesXml());

        foreach ($normalizedSheets as $index => $sheet) {
            $zip->addFromString(
                sprintf('xl/worksheets/sheet%d.xml', $index + 1),
                self::buildWorksheetXml($sheet['rows'])
            );
        }

        $zip->close();

        $contents = file_get_contents($tempPath);
        @unlink($tempPath);

        if ($contents === false) {
            throw new RuntimeException('Unable to read generated Excel archive.');
        }

        return $contents;
    }

    public static function readRows(string $filePath): array
    {
        $zip = new ZipArchive();
        if ($zip->open($filePath) !== true) {
            throw new RuntimeException('Unable to open uploaded Excel file.');
        }

        try {
            $sheetPath = self::resolveFirstWorksheetPath($zip);
            $sheetXml = $zip->getFromName($sheetPath);

            if ($sheetXml === false) {
                throw new RuntimeException('Worksheet data was not found in the uploaded Excel file.');
            }

            $sharedStrings = self::parseSharedStrings($zip->getFromName('xl/sharedStrings.xml') ?: null);

            return self::parseWorksheetRows($sheetXml, $sharedStrings);
        } finally {
            $zip->close();
        }
    }

    private static function buildContentTypesXml(int $sheetCount): string
    {
        $overrides = [];

        for ($index = 1; $index <= $sheetCount; $index++) {
            $overrides[] = sprintf(
                '<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
                $index
            );
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="' . self::CONTENT_TYPES_NS . '">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            . '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . implode('', $overrides)
            . '</Types>';
    }

    private static function buildPackageRelationshipsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="' . self::PACKAGE_RELS_NS . '">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            . '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            . '</Relationships>';
    }

    private static function buildAppPropertiesXml(array $sheets): string
    {
        $titles = implode('', array_map(
            fn (array $sheet) => '<vt:lpstr>' . self::escapeXml($sheet['name']) . '</vt:lpstr>',
            $sheets
        ));

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Properties xmlns="' . self::DOC_PROPS_NS . '" xmlns:vt="' . self::VTYPES_NS . '">'
            . '<Application>Codex</Application>'
            . '<DocSecurity>0</DocSecurity>'
            . '<ScaleCrop>false</ScaleCrop>'
            . '<HeadingPairs>'
            . '<vt:vector size="2" baseType="variant">'
            . '<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>'
            . '<vt:variant><vt:i4>' . count($sheets) . '</vt:i4></vt:variant>'
            . '</vt:vector>'
            . '</HeadingPairs>'
            . '<TitlesOfParts>'
            . '<vt:vector size="' . count($sheets) . '" baseType="lpstr">' . $titles . '</vt:vector>'
            . '</TitlesOfParts>'
            . '<Company></Company>'
            . '<LinksUpToDate>false</LinksUpToDate>'
            . '<SharedDoc>false</SharedDoc>'
            . '<HyperlinksChanged>false</HyperlinksChanged>'
            . '<AppVersion>1.0</AppVersion>'
            . '</Properties>';
    }

    private static function buildCorePropertiesXml(): string
    {
        $timestamp = gmdate('Y-m-d\TH:i:s\Z');

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<cp:coreProperties xmlns:cp="' . self::CORE_PROPS_NS . '" xmlns:dc="' . self::DC_NS . '" xmlns:dcterms="' . self::DCTERMS_NS . '" xmlns:dcmitype="' . self::DCMITYPE_NS . '" xmlns:xsi="' . self::XSI_NS . '">'
            . '<dc:creator>Codex</dc:creator>'
            . '<cp:lastModifiedBy>Codex</cp:lastModifiedBy>'
            . '<dcterms:created xsi:type="dcterms:W3CDTF">' . $timestamp . '</dcterms:created>'
            . '<dcterms:modified xsi:type="dcterms:W3CDTF">' . $timestamp . '</dcterms:modified>'
            . '</cp:coreProperties>';
    }

    private static function buildWorkbookXml(array $sheets): string
    {
        $sheetXml = implode('', array_map(
            fn (array $sheet, int $index) => sprintf(
                '<sheet name="%s" sheetId="%d" r:id="rId%d"/>',
                self::escapeXml($sheet['name']),
                $index + 1,
                $index + 1
            ),
            $sheets,
            array_keys($sheets)
        ));

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="' . self::SPREADSHEET_NS . '" xmlns:r="' . self::OFFICE_DOC_RELS_NS . '">'
            . '<sheets>' . $sheetXml . '</sheets>'
            . '</workbook>';
    }

    private static function buildWorkbookRelationshipsXml(int $sheetCount): string
    {
        $relationships = [];

        for ($index = 1; $index <= $sheetCount; $index++) {
            $relationships[] = sprintf(
                '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>',
                $index,
                $index
            );
        }

        $relationships[] = sprintf(
            '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            $sheetCount + 1
        );

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="' . self::PACKAGE_RELS_NS . '">'
            . implode('', $relationships)
            . '</Relationships>';
    }

    private static function buildStylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="' . self::SPREADSHEET_NS . '">'
            . '<fonts count="2">'
            . '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
            . '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
            . '</fonts>'
            . '<fills count="2">'
            . '<fill><patternFill patternType="none"/></fill>'
            . '<fill><patternFill patternType="gray125"/></fill>'
            . '</fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="2">'
            . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    private static function buildWorksheetXml(array $rows): string
    {
        $rowXml = [];
        $maxColumn = 1;

        foreach (array_values($rows) as $rowIndex => $row) {
            $cells = [];
            $values = array_values(is_array($row) ? $row : [$row]);
            $maxColumn = max($maxColumn, count($values));

            foreach ($values as $columnIndex => $value) {
                $cellXml = self::buildCellXml($rowIndex + 1, $columnIndex + 1, $value, $rowIndex === 0 ? 1 : 0);
                if ($cellXml !== null) {
                    $cells[] = $cellXml;
                }
            }

            $rowXml[] = sprintf('<row r="%d">%s</row>', $rowIndex + 1, implode('', $cells));
        }

        $dimension = sprintf('A1:%s%d', self::columnNameFromIndex($maxColumn), max(count($rows), 1));

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="' . self::SPREADSHEET_NS . '">'
            . '<dimension ref="' . $dimension . '"/>'
            . '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
            . '<sheetFormatPr defaultRowHeight="15"/>'
            . '<sheetData>' . implode('', $rowXml) . '</sheetData>'
            . '</worksheet>';
    }

    private static function buildCellXml(int $rowIndex, int $columnIndex, mixed $value, int $styleIndex = 0): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $cellRef = self::columnNameFromIndex($columnIndex) . $rowIndex;
        $style = $styleIndex > 0 ? ' s="' . $styleIndex . '"' : '';

        if (is_bool($value)) {
            return sprintf('<c r="%s"%s><v>%d</v></c>', $cellRef, $style, $value ? 1 : 0);
        }

        if (is_int($value) || is_float($value)) {
            return sprintf('<c r="%s"%s><v>%s</v></c>', $cellRef, $style, self::escapeXml((string) $value));
        }

        $text = self::escapeXml((string) $value);

        return sprintf(
            '<c r="%s" t="inlineStr"%s><is><t xml:space="preserve">%s</t></is></c>',
            $cellRef,
            $style,
            $text
        );
    }

    private static function resolveFirstWorksheetPath(ZipArchive $zip): string
    {
        $workbookXml = $zip->getFromName('xl/workbook.xml');
        $workbookRelsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');

        if ($workbookXml !== false && $workbookRelsXml !== false) {
            $workbook = self::loadXml($workbookXml);
            $relationships = self::loadXml($workbookRelsXml);

            $sheets = self::xpath($workbook, '//main:sheets/main:sheet');
            $relationshipNodes = self::xpath($relationships, '//main:Relationship');

            $targetsById = [];
            foreach ($relationshipNodes as $relationshipNode) {
                $targetsById[(string) $relationshipNode['Id']] = (string) $relationshipNode['Target'];
            }

            if (!empty($sheets)) {
                $relationshipId = (string) ($sheets[0]->attributes(self::OFFICE_DOC_RELS_NS)->id ?? '');
                $target = $targetsById[$relationshipId] ?? null;
                if ($target) {
                    $target = ltrim($target, '/');
                    return str_starts_with($target, 'xl/')
                        ? $target
                        : 'xl/' . ltrim($target, '/');
                }
            }
        }

        for ($index = 1; $index <= 50; $index++) {
            $candidate = sprintf('xl/worksheets/sheet%d.xml', $index);
            if ($zip->locateName($candidate) !== false) {
                return $candidate;
            }
        }

        throw new RuntimeException('No worksheet was found in the uploaded Excel file.');
    }

    private static function parseSharedStrings(?string $xml): array
    {
        if ($xml === null || trim($xml) === '') {
            return [];
        }

        $document = self::loadXml($xml);
        $items = [];

        foreach (self::xpath($document, '//main:si') as $item) {
            $parts = [];

            foreach (self::xpath($item, './main:t|./main:r/main:t') as $textNode) {
                $parts[] = (string) $textNode;
            }

            $items[] = implode('', $parts);
        }

        return $items;
    }

    private static function parseWorksheetRows(string $xml, array $sharedStrings): array
    {
        $document = self::loadXml($xml);
        $rows = [];

        foreach (self::xpath($document, '//main:sheetData/main:row') as $rowNode) {
            $cells = [];
            $maxIndex = 0;

            foreach (self::xpath($rowNode, './main:c') as $cellNode) {
                $reference = (string) $cellNode['r'];
                $columnName = preg_replace('/\d+/', '', $reference) ?: 'A';
                $columnIndex = self::columnIndexFromName($columnName);
                $cells[$columnIndex] = self::parseCellValue($cellNode, $sharedStrings);
                $maxIndex = max($maxIndex, $columnIndex);
            }

            if ($maxIndex === 0) {
                $rows[] = [];
                continue;
            }

            $row = [];
            for ($columnIndex = 1; $columnIndex <= $maxIndex; $columnIndex++) {
                $row[] = $cells[$columnIndex] ?? '';
            }

            $rows[] = $row;
        }

        return $rows;
    }

    private static function parseCellValue(SimpleXMLElement $cellNode, array $sharedStrings): string
    {
        $type = (string) $cellNode['t'];

        if ($type === 'inlineStr') {
            $parts = [];
            foreach (self::xpath($cellNode, './main:is/main:t|./main:is/main:r/main:t') as $textNode) {
                $parts[] = (string) $textNode;
            }

            return implode('', $parts);
        }

        $valueNodes = self::xpath($cellNode, './main:v');
        $value = isset($valueNodes[0]) ? (string) $valueNodes[0] : '';

        if ($type === 's') {
            $index = is_numeric($value) ? (int) $value : -1;
            return $sharedStrings[$index] ?? '';
        }

        if ($type === 'b') {
            return $value === '1' ? '1' : '0';
        }

        return $value;
    }

    private static function loadXml(string $xml): SimpleXMLElement
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = simplexml_load_string($xml);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        if (!$document instanceof SimpleXMLElement) {
            throw new RuntimeException('Unable to parse Excel XML payload.');
        }

        return $document;
    }

    private static function xpath(SimpleXMLElement $element, string $expression): array
    {
        $namespaces = $element->getNamespaces(true);
        $element->registerXPathNamespace('main', $namespaces[''] ?? self::SPREADSHEET_NS);

        return $element->xpath($expression) ?: [];
    }

    private static function columnNameFromIndex(int $index): string
    {
        $name = '';

        while ($index > 0) {
            $index--;
            $name = chr(65 + ($index % 26)) . $name;
            $index = intdiv($index, 26);
        }

        return $name ?: 'A';
    }

    private static function columnIndexFromName(string $name): int
    {
        $index = 0;
        $letters = strtoupper(trim($name));

        for ($position = 0; $position < strlen($letters); $position++) {
            $index = ($index * 26) + (ord($letters[$position]) - 64);
        }

        return max($index, 1);
    }

    private static function sanitizeSheetName(string $name): string
    {
        $clean = trim(preg_replace('/[\[\]\:\*\?\/\\\\]+/', ' ', $name) ?? '');
        $clean = $clean !== '' ? $clean : 'Sheet 1';

        return mb_substr($clean, 0, 31);
    }

    private static function escapeXml(string $value): string
    {
        $clean = preg_replace('/[^\x09\x0A\x0D\x20-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', $value) ?? '';

        return htmlspecialchars($clean, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
}
