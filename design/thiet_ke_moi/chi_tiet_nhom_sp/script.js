// Image Gallery Logic
function changeImg(src, el) {
    document.getElementById('mainImg').src = src;
    document.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
}

// Combo Recalculation Logic
let basePrice = 4100000; // Base items price

function toggleItem(el) {
    const checkbox = el.querySelector('.item-checkbox');
    // If it's the checkbox being clicked, it will toggle twice, so we handle it
    // But since the parent handles click, we just toggle everything
    
    if (checkbox.disabled) return;

    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
        el.classList.remove('disabled');
    } else {
        el.classList.add('disabled');
    }
    
    updateTotalPrice();
}

function updateTotalPrice() {
    let total = basePrice;
    const items = document.querySelectorAll('.combo-item');
    
    items.forEach(item => {
        const checkbox = item.querySelector('.item-checkbox');
        const price = parseInt(item.getAttribute('data-price') || 0);
        
        if (checkbox.checked && !checkbox.disabled) {
            total += price;
        }
    });

    const mainQty = parseInt(document.getElementById('mainQty').value);
    const finalPrice = total * mainQty;
    
    document.getElementById('totalPrice').textContent = finalPrice.toLocaleString('vi-VN') + '₫';
}

// Main Quantity Logic
function changeMainQty(change) {
    const input = document.getElementById('mainQty');
    let val = parseInt(input.value) + change;
    if (val < 1) val = 1;
    input.value = val;
    updateTotalPrice();
}

// Initial calculation
window.onload = updateTotalPrice;

// Simple Tab switching
document.querySelectorAll('.tab').forEach((tab, index) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // In real app, toggle content here
    });
});
