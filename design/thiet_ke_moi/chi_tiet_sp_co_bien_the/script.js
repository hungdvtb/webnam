document.addEventListener('DOMContentLoaded', () => {
    const currentImg = document.getElementById('current-image');
    const currentPrice = document.getElementById('current-price');
    const currentSku = document.getElementById('current-sku');
    const selectedColorLabel = document.getElementById('selected-color-label');
    const selectedSizeLabel = document.getElementById('selected-size-label');
    const colorOptions = document.querySelectorAll('#color-options .option-btn');
    const sizeOptions = document.querySelectorAll('#size-options .option-btn');
    const thumbs = document.querySelectorAll('.thumb');
    
    // Qty buttons
    const qtyValue = document.getElementById('qty-value');
    const qtyPlus = document.getElementById('qty-plus');
    const qtyMinus = document.getElementById('qty-minus');

    function formatPrice(val) {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
    }

    // Color/Variant selection
    colorOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            // UI
            colorOptions.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Labels
            const label = btn.getAttribute('data-label');
            selectedColorLabel.textContent = label;
            
            // Image
            const imgPath = btn.getAttribute('data-img');
            currentImg.style.opacity = '0';
            setTimeout(() => {
                currentImg.src = imgPath;
                currentImg.style.opacity = '1';
            }, 200);

            // Thumbnail Sync
            thumbs.forEach(t => {
                t.classList.remove('active');
                if (t.getAttribute('data-img') === imgPath) {
                    t.classList.add('active');
                }
            });

            // Price & SKU
            const price = parseInt(btn.getAttribute('data-price'));
            const sku = btn.getAttribute('data-sku');
            
            // Add size modifier if large
            const activeSize = document.querySelector('#size-options .option-btn.active').getAttribute('data-value');
            const finalPrice = activeSize === 'large' ? price + 250000 : price;
            
            currentPrice.textContent = formatPrice(finalPrice);
            currentSku.textContent = sku;
        });
    });

    // Size selection
    sizeOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            sizeOptions.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            selectedSizeLabel.textContent = btn.getAttribute('data-label');
            
            // Trigger price update from active color
            const activeColorBtn = document.querySelector('#color-options .option-btn.active');
            if (activeColorBtn) activeColorBtn.click();
        });
    });

    // Thumbnails click
    thumbs.forEach(thumb => {
        thumb.addEventListener('click', () => {
            const variantValue = thumb.getAttribute('data-variant');
            const colorBtn = document.querySelector(`#color-options .option-btn[data-value="${variantValue}"]`);
            if (colorBtn) colorBtn.click();
        });
    });

    // Quantity
    qtyPlus.addEventListener('click', () => {
        qtyValue.value = parseInt(qtyValue.value) + 1;
    });
    
    qtyMinus.addEventListener('click', () => {
        const val = parseInt(qtyValue.value);
        if (val > 1) qtyValue.value = val - 1;
    });

    // Add to cart micro-animation
    const addBtn = document.querySelector('.add-to-cart');
    addBtn.addEventListener('click', () => {
        addBtn.innerHTML = '<span class="material-symbols-outlined">done</span> ĐÃ THÊM';
        addBtn.style.background = '#27ae60';
        
        setTimeout(() => {
            addBtn.innerHTML = '<span class="material-symbols-outlined">shopping_cart</span> THÊM VÀO GIỎ HÀNG';
            addBtn.style.background = '#2C3E50';
        }, 2000);
    });
});
