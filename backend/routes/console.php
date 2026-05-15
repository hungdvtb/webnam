<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

if ((bool) config('meta_catalog.enabled', false)) {
    Schedule::command('meta-catalog:sync-products --delete-stale')
        ->hourly()
        ->withoutOverlapping(55);
}
