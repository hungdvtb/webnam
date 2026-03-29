<?php

namespace App\Services;

use DOMDocument;
use DOMElement;
use DOMXPath;
use RuntimeException;
use ZipArchive;

class SimpleXlsxService
{
    /**
     * @param  array<int, string>  $headers
     * @param  array<int, array<string, mixed>>  $rows
     */
    public function write(string $absolutePath, array $headers, array $rows, string $sheetName = 'Posts'): void
    {
        $directory = dirname($absolutePath);
        if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create XLSX directory.');
        }

        $zip = new ZipArchive();
        if ($zip->open($absolutePath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Unable to create XLSX archive.');
        }

        $sheetRows = [];
        $sheetRows[] = array_map(fn ($header) => (string) $header, array_values($headers));

        foreach ($rows as $row) {
            $values = [];
            foreach ($headers as $header) {
                $values[] = $this->stringifyCellValue($row[$header] ?? '');
            }
            $sheetRows[] = $values;
        }

        $zip->addFromString('[Content_Types].xml', $this->contentTypesXml());
        $zip->addFromString('_rels/.rels', $this->rootRelationshipsXml());
        $zip->addFromString('docProps/app.xml', $this->appPropertiesXml($sheetName));
        $zip->addFromString('docProps/core.xml', $this->corePropertiesXml());
        $zip->addFromString('xl/workbook.xml', $this->workbookXml($sheetName));
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRelationshipsXml());
        $zip->addFromString('xl/styles.xml', $this->stylesXml());
        $zip->addFromString('xl/worksheets/sheet1.xml', $this->worksheetXml($sheetRows));
        $zip->close();
    }

    /**
     * @return array{headers: array<int, string>, rows: array<int, array<string, string>>}
     */
    public function read(string $absolutePath): array
    {
        $zip = new ZipArchive();
        if ($zip->open($absolutePath) !== true) {
            throw new RuntimeException('Unable to open XLSX archive.');
        }

        $workbookXml = $zip->getFromName('xl/workbook.xml');
        $relsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
        $sharedStringsXml = $zip->getFromName('xl/sharedStrings.xml');

        if ($workbookXml === false || $relsXml === false) {
            $zip->close();
            throw new RuntimeException('Invalid XLSX structure.');
        }

        $sheetPath = $this->resolveFirstWorksheetPath($workbookXml, $relsXml);
        $worksheetXml = $zip->getFromName($sheetPath);
        $zip->close();

        if ($worksheetXml === false) {
            throw new RuntimeException('Worksheet not found in XLSX archive.');
        }

        $sharedStrings = $this->readSharedStrings($sharedStringsXml ?: null);
        $rows = $this->readWorksheetRows($worksheetXml, $sharedStrings);

        if (empty($rows)) {
            return [
                'headers' => [],
                'rows' => [],
            ];
        }

        $headers = array_map('trim', array_map('strval', array_shift($rows)));
        $dataRows = [];

        foreach ($rows as $row) {
            $assoc = [];
            foreach ($headers as $index => $header) {
                if ($header === '') {
                    continue;
                }

                $assoc[$header] = (string) ($row[$index] ?? '');
            }
            if (!empty(array_filter($assoc, fn ($value) => trim((string) $value) !== ''))) {
                $dataRows[] = $assoc;
            }
        }

        return [
            'headers' => $headers,
            'rows' => $dataRows,
        ];
    }

    private function stringifyCellValue(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        if (is_scalar($value)) {
            return (string) $value;
        }

        return (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param  array<int, array<int, string>>  $rows
     */
    private function worksheetXml(array $rows): string
    {
        $sheetData = [];

        foreach ($rows as $rowIndex => $row) {
            $cells = [];

            foreach ($row as $columnIndex => $value) {
                $cellRef = $this->columnLetters($columnIndex + 1) . ($rowIndex + 1);
                $text = $this->escapeXmlText($value);
                $cells[] = sprintf(
                    '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>',
                    $cellRef,
                    $text
                );
            }

            $sheetData[] = sprintf(
                '<row r="%d" spans="1:%d">%s</row>',
                $rowIndex + 1,
                max(count($row), 1),
                implode('', $cells)
            );
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            . 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
            . '<sheetFormatPr defaultRowHeight="15"/>'
            . '<sheetData>' . implode('', $sheetData) . '</sheetData>'
            . '</worksheet>';
    }

    private function contentTypesXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
XML;
    }

    private function rootRelationshipsXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
XML;
    }

    private function appPropertiesXml(string $sheetName): string
    {
        $escapedSheetName = $this->escapeXmlText($sheetName);

        return <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>Codex</Application>
    <DocSecurity>0</DocSecurity>
    <ScaleCrop>false</ScaleCrop>
    <HeadingPairs>
        <vt:vector size="2" baseType="variant">
            <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
            <vt:variant><vt:i4>1</vt:i4></vt:variant>
        </vt:vector>
    </HeadingPairs>
    <TitlesOfParts>
        <vt:vector size="1" baseType="lpstr">
            <vt:lpstr>{$escapedSheetName}</vt:lpstr>
        </vt:vector>
    </TitlesOfParts>
    <Company></Company>
    <LinksUpToDate>false</LinksUpToDate>
    <SharedDoc>false</SharedDoc>
    <HyperlinksChanged>false</HyperlinksChanged>
    <AppVersion>16.0000</AppVersion>
</Properties>
XML;
    }

    private function corePropertiesXml(): string
    {
        $timestamp = gmdate('Y-m-d\TH:i:s\Z');

        return <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:creator>Codex</dc:creator>
    <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
    <dcterms:created xsi:type="dcterms:W3CDTF">{$timestamp}</dcterms:created>
    <dcterms:modified xsi:type="dcterms:W3CDTF">{$timestamp}</dcterms:modified>
</cp:coreProperties>
XML;
    }

    private function workbookXml(string $sheetName): string
    {
        $escapedSheetName = $this->escapeXmlText($sheetName);

        return <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <bookViews>
        <workbookView xWindow="240" yWindow="15" windowWidth="16095" windowHeight="9660"/>
    </bookViews>
    <sheets>
        <sheet name="{$escapedSheetName}" sheetId="1" r:id="rId1"/>
    </sheets>
</workbook>
XML;
    }

    private function workbookRelationshipsXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
XML;
    }

    private function stylesXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="1">
        <font>
            <sz val="11"/>
            <name val="Calibri"/>
            <family val="2"/>
        </font>
    </fonts>
    <fills count="2">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
    </fills>
    <borders count="1">
        <border>
            <left/>
            <right/>
            <top/>
            <bottom/>
            <diagonal/>
        </border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    </cellXfs>
    <cellStyles count="1">
        <cellStyle name="Normal" xfId="0" builtinId="0"/>
    </cellStyles>
</styleSheet>
XML;
    }

    private function resolveFirstWorksheetPath(string $workbookXml, string $relationshipsXml): string
    {
        $workbook = new DOMDocument();
        $workbook->loadXML($workbookXml, LIBXML_NOERROR | LIBXML_NOWARNING);

        $workbookXpath = new DOMXPath($workbook);
        $workbookXpath->registerNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        $workbookXpath->registerNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');

        $sheetNode = $workbookXpath->query('//main:sheets/main:sheet')->item(0);
        if (!$sheetNode instanceof DOMElement) {
            throw new RuntimeException('No worksheet found in workbook.');
        }

        $relationshipId = $sheetNode->getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
            ?: $sheetNode->getAttribute('r:id');

        if ($relationshipId === '') {
            throw new RuntimeException('Worksheet relationship is missing.');
        }

        $rels = new DOMDocument();
        $rels->loadXML($relationshipsXml, LIBXML_NOERROR | LIBXML_NOWARNING);

        $relsXpath = new DOMXPath($rels);
        $relsXpath->registerNamespace('rel', 'http://schemas.openxmlformats.org/package/2006/relationships');

        foreach ($relsXpath->query('//rel:Relationship') ?: [] as $relationshipNode) {
            if (!$relationshipNode instanceof DOMElement) {
                continue;
            }

            if ($relationshipNode->getAttribute('Id') === $relationshipId) {
                $target = trim($relationshipNode->getAttribute('Target'));
                if ($target === '') {
                    break;
                }

                return str_starts_with($target, 'xl/')
                    ? $target
                    : 'xl/' . ltrim($target, '/');
            }
        }

        throw new RuntimeException('Unable to resolve worksheet path.');
    }

    /**
     * @return array<int, string>
     */
    private function readSharedStrings(?string $sharedStringsXml): array
    {
        if ($sharedStringsXml === null || trim($sharedStringsXml) === '') {
            return [];
        }

        $dom = new DOMDocument();
        $dom->loadXML($sharedStringsXml, LIBXML_NOERROR | LIBXML_NOWARNING);

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

        $values = [];
        foreach ($xpath->query('//main:si') ?: [] as $itemNode) {
            $values[] = $this->collectNodeText($itemNode);
        }

        return $values;
    }

    /**
     * @param  array<int, string>  $sharedStrings
     * @return array<int, array<int, string>>
     */
    private function readWorksheetRows(string $worksheetXml, array $sharedStrings): array
    {
        $dom = new DOMDocument();
        $dom->loadXML($worksheetXml, LIBXML_NOERROR | LIBXML_NOWARNING);

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

        $rows = [];

        foreach ($xpath->query('//main:sheetData/main:row') ?: [] as $rowNode) {
            if (!$rowNode instanceof DOMElement) {
                continue;
            }

            $cells = [];
            $maxIndex = -1;

            foreach ($xpath->query('./main:c', $rowNode) ?: [] as $cellNode) {
                if (!$cellNode instanceof DOMElement) {
                    continue;
                }

                $cellRef = $cellNode->getAttribute('r');
                $columnLetters = preg_replace('/[^A-Z]/i', '', $cellRef);
                $columnIndex = $columnLetters !== ''
                    ? $this->columnIndex($columnLetters)
                    : ($maxIndex + 1);

                $cells[$columnIndex] = $this->readCellValue($cellNode, $sharedStrings);
                $maxIndex = max($maxIndex, $columnIndex);
            }

            if ($maxIndex < 0) {
                continue;
            }

            $rowValues = [];
            for ($index = 0; $index <= $maxIndex; $index++) {
                $rowValues[] = (string) ($cells[$index] ?? '');
            }
            $rows[] = $rowValues;
        }

        return $rows;
    }

    /**
     * @param  array<int, string>  $sharedStrings
     */
    private function readCellValue(DOMElement $cellNode, array $sharedStrings): string
    {
        $type = $cellNode->getAttribute('t');

        if ($type === 'inlineStr') {
            foreach ($cellNode->childNodes as $childNode) {
                if ($childNode instanceof DOMElement && $childNode->localName === 'is') {
                    return $this->collectNodeText($childNode);
                }
            }

            return '';
        }

        $valueNode = null;
        foreach ($cellNode->childNodes as $childNode) {
            if ($childNode instanceof DOMElement && $childNode->localName === 'v') {
                $valueNode = $childNode;
                break;
            }
        }

        $value = trim((string) ($valueNode?->textContent ?? ''));

        if ($type === 's') {
            $index = (int) $value;
            return $sharedStrings[$index] ?? '';
        }

        if ($type === 'b') {
            return $value === '1' ? '1' : '0';
        }

        return $value;
    }

    private function collectNodeText(\DOMNode $node): string
    {
        $text = '';

        foreach ($node->childNodes as $childNode) {
            if ($childNode instanceof DOMElement) {
                if (in_array($childNode->localName, ['t', 'v'], true)) {
                    $text .= (string) $childNode->textContent;
                    continue;
                }

                $text .= $this->collectNodeText($childNode);
                continue;
            }

            $text .= (string) $childNode->textContent;
        }

        return $text;
    }

    private function escapeXmlText(string $value): string
    {
        return htmlspecialchars($this->sanitizeXmlString($value), ENT_XML1 | ENT_COMPAT, 'UTF-8');
    }

    private function sanitizeXmlString(string $value): string
    {
        return preg_replace('/[^\P{C}\t\n\r]+/u', '', $value) ?? '';
    }

    private function columnLetters(int $columnIndex): string
    {
        $letters = '';

        while ($columnIndex > 0) {
            $columnIndex--;
            $letters = chr(65 + ($columnIndex % 26)) . $letters;
            $columnIndex = intdiv($columnIndex, 26);
        }

        return $letters;
    }

    private function columnIndex(string $letters): int
    {
        $letters = strtoupper(trim($letters));
        $index = 0;

        for ($i = 0; $i < strlen($letters); $i++) {
            $index = ($index * 26) + (ord($letters[$i]) - 64);
        }

        return max($index - 1, 0);
    }
}
