<?php

use App\Http\Controllers\MetaFeedController;
use Illuminate\Support\Facades\Route;

Route::get('/meta-feed.csv', [MetaFeedController::class, 'csv']);
Route::get('/meta-feed.xml', [MetaFeedController::class, 'xml']);

Route::get('/', function () {
    return view('welcome');
});
