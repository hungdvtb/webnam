/**
 * Advanced Image Compression for high-quality product photos
 * Targets a specific size range: 600KB - 900KB
 * @param {File} file - Original file
 * @returns {Promise<File>} - Optimized file
 */
export const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const targetMin = 0.58 * 1024 * 1024; // ~600KB
        const targetMax = 0.88 * 1024 * 1024; // ~900KB

        // If file is already in the range or smaller, just return it (avoid double compression)
        if (file.size <= targetMax) {
            // But if it's too small and we want to "verify" it, we could still pass it through.
            // For now, if it's already under 900KB, it's good for the system.
            return resolve(file);
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // For product photos, we usually want at least 1600px width/height for detail
                const maxDim = 2400; 
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = (maxDim / width) * height;
                        width = maxDim;
                    } else {
                        width = (maxDim / height) * width;
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Smart quality detection
                // We'll try a high quality first, if it's still too large, we step down.
                const tryCompress = (quality) => {
                    canvas.toBlob((blob) => {
                        if (!blob) return reject(new Error('Compression failed'));
                        
                        if (blob.size > targetMax && quality > 0.5) {
                            // Still too big, try lower quality
                            tryCompress(quality - 0.1);
                        } else {
                            const optimizedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now(),
                            });
                            resolve(optimizedFile);
                        }
                    }, 'image/jpeg', quality);
                };

                tryCompress(0.85); // Start with high quality (85%)
            };
            img.onerror = () => reject(new Error('Image load error'));
        };
        reader.onerror = () => reject(new Error('File read error'));
    });
};

/**
 * Helper to format bytes to human readable string
 */
export const formatBytes = (bytes, decimals = 0) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};
