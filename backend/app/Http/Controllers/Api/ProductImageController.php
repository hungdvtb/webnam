<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ProductImageController extends Controller
{
    /**
     * Upload images to S3 and associate with a product
     */
    public function store(Request $request, $productId)
    {
        $request->validate([
            'images' => 'required',
            'images.*' => 'image|mimes:jpeg,png,jpg,gif,webp|max:5120', // 5MB max each
        ]);

        $product = Product::findOrFail($productId);
        $uploadedImages = [];

        if($request->hasFile('images')) {
            foreach ($request->file('images') as $file) {
                // Store on S3
                $path = $file->store('products', 's3');
                $url = Storage::disk('s3')->url($path);

                // Check if this is the first image, if so set as default primary
                $isPrimary = $product->images()->count() === 0;

                $image = ProductImage::create([
                    'product_id' => $productId,
                    'image_url' => $url,
                    'is_primary' => $isPrimary,
                    'sort_order' => $product->images()->count()
                ]);

                $uploadedImages[] = $image;
            }
        }

        return response()->json($uploadedImages, 201);
    }

    /**
     * Set an image as primary (main)
     */
    public function setPrimary($id)
    {
        $image = ProductImage::findOrFail($id);
        
        // Reset all other images for this product
        ProductImage::where('product_id', $image->product_id)
            ->update(['is_primary' => false]);
            
        $image->update(['is_primary' => true]);
        
        return response()->json(['message' => 'Image set as primary.']);
    }

    /**
     * Delete an image from DB and S3
     */
    public function destroy($id)
    {
        $image = ProductImage::findOrFail($id);
        
        // Extract S3 path from URL if needed
        $baseUrl = config('filesystems.disks.s3.url');
        $path = str_replace($baseUrl . '/', '', $image->image_url);
        
        Storage::disk('s3')->delete($path);
        
        $image->delete();
        
        return response()->json(['message' => 'Image deleted successfully.']);
    }
}
