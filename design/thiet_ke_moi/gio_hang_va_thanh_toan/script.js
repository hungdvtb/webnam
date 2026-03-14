function increment(id) {
    const input = document.getElementById(id);
    input.value = parseInt(input.value) + 1;
}

function decrement(id) {
    const input = document.getElementById(id);
    if (parseInt(input.value) > 1) {
        input.value = parseInt(input.value) - 1;
    }
}

// Payment method selection
const paymentOptions = document.querySelectorAll('.payment-option');
paymentOptions.forEach(option => {
    option.addEventListener('click', () => {
        paymentOptions.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        option.querySelector('input').checked = true;
    });
});

// Remove child item from combo logic (for demo)
const removeButtons = document.querySelectorAll('.child-remove');
removeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const item = e.target.closest('.child-item');
        if (confirm('Bạn có chắc muốn loại bỏ sản phẩm này khỏi combo?')) {
            item.style.opacity = '0.5';
            item.style.pointerEvents = 'none';
            btn.textContent = 'Đã bỏ';
            btn.style.color = '#ccc';
            
            // In a real app, you would recalculate the price here
            alert('Giá combo sẽ được tính lại dựa trên các thành phần còn lại.');
        }
    });
});

// Smooth scroll implementation for steps
document.querySelectorAll('.section-number').forEach((num, index) => {
    num.style.cursor = 'pointer';
    num.addEventListener('click', () => {
        const sections = document.querySelectorAll('.section-card');
        sections[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
});
