<?php

namespace App\Http\Controllers;

use App\Services\MetaFeedService;

class MetaFeedController extends Controller
{
    public function csv(MetaFeedService $feed)
    {
        return response()->stream(function () use ($feed) {
            $stream = fopen('php://output', 'w');
            $feed->writeCsv($stream);
            fclose($stream);
        }, 200, $this->headers('text/csv; charset=UTF-8', 'meta-feed.csv'));
    }

    public function xml(MetaFeedService $feed)
    {
        return response()->stream(function () use ($feed) {
            $feed->writeXml();
        }, 200, $this->headers('application/xml; charset=UTF-8', 'meta-feed.xml'));
    }

    private function headers(string $contentType, string $filename): array
    {
        return [
            'Content-Type' => $contentType,
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, max-age=0',
            'Pragma' => 'no-cache',
        ];
    }
}
