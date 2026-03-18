export function flyToCart(e, imageUrl) {
  if (!e || !imageUrl) return;
  const btn = e.currentTarget || e.target;
  const btnRect = btn.getBoundingClientRect();
  
  // Find cart icon element
  const cartIcon = document.querySelector('.cart-action') || document.querySelector('.site-header a[href="/cart"]');
  if (!cartIcon) return;
  
  const cartRect = cartIcon.getBoundingClientRect();

  // Create flying element
  const flyImg = document.createElement('img');
  flyImg.src = imageUrl;
  flyImg.style.position = 'fixed';
  flyImg.style.top = `${btnRect.top}px`;
  flyImg.style.left = `${btnRect.left + (btnRect.width / 2) - 20}px`;
  flyImg.style.width = '40px';
  flyImg.style.height = '40px';
  flyImg.style.borderRadius = '50%';
  flyImg.style.objectFit = 'cover';
  flyImg.style.zIndex = '9999';
  flyImg.style.transition = 'all 1s cubic-bezier(0.25, 1, 0.5, 1)';
  flyImg.style.boxShadow = '0 10px 20px rgba(0,0,0,0.1)';
  flyImg.style.pointerEvents = 'none';
  
  document.body.appendChild(flyImg);

  // Trigger animation next frame
  requestAnimationFrame(() => {
    // A small delay to ensure browser applies initial styles
    requestAnimationFrame(() => {
      flyImg.style.top = `${cartRect.top + 10}px`;
      flyImg.style.left = `${cartRect.left + 10}px`;
      flyImg.style.width = '10px';
      flyImg.style.height = '10px';
      flyImg.style.opacity = '0.5';
      flyImg.style.transform = 'scale(0.5)';
    });
  });

  // Clean up and animate cart icon
  setTimeout(() => {
    if (document.body.contains(flyImg)) document.body.removeChild(flyImg);
    cartIcon.classList.remove('bounce-cart');
    void cartIcon.offsetWidth; // Trigger reflow
    cartIcon.classList.add('bounce-cart');
  }, 1000);
}
