<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FinCategory extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'type', 'color'];

    public function transactions()
    {
        return $this->hasMany(FinTransaction::class);
    }
}
