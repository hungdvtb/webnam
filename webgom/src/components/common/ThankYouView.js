"use client";

import React from 'react';
import Link from 'next/link';

export default function ThankYouView({ orderNumber, formData, cartItems, cartTotal, discount, bankSettings }) {
  const finalTotal = cartTotal - discount;
  
  // Format currency
  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  return (
    <div className="thank-you-container animate-fade-in" style={{ padding: '2rem 0', maxWidth: '900px', margin: '0 auto' }}>
      {/* Success Banner */}
      <div className="success-card border border-stone/20 shadow-premium rounded-2xl overflow-hidden bg-white">
        <div className="banner-header bg-primary relative flex items-center justify-center py-10 overflow-hidden" style={{ minHeight: '200px' }}>
          {/* Decorative pattern overlay */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/az-subtle.png")' }}></div>
          
          {/* Decorative border pattern */}
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-accent via-accent/50 to-accent"></div>
          <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gradient-to-r from-accent via-accent/50 to-accent"></div>
          
          <div className="z-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent text-white mb-4 shadow-lg">
              <span className="material-symbols-outlined text-4xl">check_circle</span>
            </div>
            <h1 className="text-white text-3xl font-display font-bold tracking-wide italic">Giao dịch Hoàn tất</h1>
          </div>
        </div>

        <div className="content-body p-8 md:p-12">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-display text-primary mb-4 italic">Cảm ơn Quý khách đã trân trọng di sản!</h2>
            <p className="text-lg text-slate-600 leading-relaxed font-body max-w-2xl mx-auto">
              Đơn hàng của Quý khách đã được tiếp nhận và đang được chúng tôi chuẩn bị kỹ lưỡng. Một email xác nhận chi tiết sẽ được gửi đến địa chỉ của Quý khách.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-10">
            {/* Order Info */}
            <div className="info-block bg-stone/5 border border-stone/10 p-6 rounded-xl">
              <h3 className="font-display text-xl border-b border-stone/10 pb-3 mb-4 flex items-center gap-2 text-primary uppercase tracking-tight">
                <span className="material-symbols-outlined text-accent">receipt_long</span>
                Chi tiết Đơn hàng
              </h3>
              <div className="space-y-3 font-body text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Mã số đơn hàng:</span>
                  <span className="font-bold text-primary font-mono">#{orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ngày đặt:</span>
                  <span className="text-primary font-medium">{new Date().toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Phương thức:</span>
                  <span className="text-primary font-medium">{formData.paymentMethod === 'bank' ? 'Chuyển khoản Ngân hàng' : 'Thanh toán khi nhận hàng (COD)'}</span>
                </div>
                <div className="flex justify-between border-t border-stone/10 pt-3 mt-3">
                  <span className="text-slate-500 font-bold uppercase text-[11px] tracking-wider">Tổng cộng:</span>
                  <span className="text-xl font-bold text-primary">{formatPrice(finalTotal)}</span>
                </div>
              </div>
            </div>

            {/* Shipping Info */}
            <div className="info-block bg-stone/5 border border-stone/10 p-6 rounded-xl">
              <h3 className="font-display text-xl border-b border-stone/10 pb-3 mb-4 flex items-center gap-2 text-primary uppercase tracking-tight">
                <span className="material-symbols-outlined text-accent">local_shipping</span>
                Thông tin Giao nhận
              </h3>
              <div className="font-body space-y-2 text-sm">
                <p className="font-bold text-primary text-base">{formData.customer_name}</p>
                <p className="text-slate-600 flex items-center gap-1">
                   <span className="material-symbols-outlined text-[16px]">call</span>
                   {formData.phone}
                </p>
                <p className="text-slate-600 flex items-start gap-1">
                   <span className="material-symbols-outlined text-[16px] mt-0.5">location_on</span>
                   <span>{[formData.address, formData.ward, formData.district, formData.province].filter(Boolean).join(', ')}</span>
                </p>
                <p className="italic text-xs text-accent mt-4">Dự kiến giao hàng: 3-5 ngày làm việc</p>
              </div>
            </div>
          </div>

          {/* Product Summary */}
          <div className="product-summary mb-12">
            <h3 className="font-display text-xl mb-6 flex items-center gap-2 text-primary uppercase tracking-tight">
              <span className="material-symbols-outlined text-accent">inventory_2</span>
              Sản phẩm đã chọn
            </h3>
            <div className="border border-stone/10 rounded-xl overflow-hidden shadow-sm">
              {cartItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-4 p-4 border-b border-stone/10 last:border-0 bg-white">
                  <div className="w-20 h-20 bg-stone/5 rounded-lg overflow-hidden flex-shrink-0 border border-stone/10">
                    <img 
                      src={item.main_image || (item.images?.find(i => i.is_primary) || item.images?.[0])?.image_url || 'https://placehold.co/100'} 
                      alt={item.name} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-display text-lg text-primary truncate">{item.name}</h4>
                    <p className="text-xs text-slate-500 font-body">Đơn giá: {formatPrice(item.price)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">{formatPrice(item.price * item.quantity)}</p>
                    <p className="text-xs text-slate-500 font-body italic">Số lượng: {item.quantity < 10 ? `0${item.quantity}` : item.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bank Transfer Instructions if needed */}
          {formData.payment_method === 'bank' && bankSettings && (
             <div className="bank-instructions mb-12 p-6 bg-amber-50/50 border border-amber-200 rounded-xl animate-fade-in">
                <h4 className="text-amber-800 font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                   <span className="material-symbols-outlined">payments</span> 
                   Hướng dẫn Chuyển khoản
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
                   <div className="space-y-2 text-sm text-slate-700 font-body">
                      <p><strong>Ngân hàng:</strong> {bankSettings.bank_name}</p>
                      <p><strong>Số tài khoản:</strong> <span className="text-lg font-bold text-primary font-mono">{bankSettings.bank_account_number}</span></p>
                      <p><strong>Chủ tài khoản:</strong> {bankSettings.bank_account_name}</p>
                      <p className="pt-2 border-t border-amber-200">
                        <strong>Nội dung:</strong> <span className="text-accent italic">
                           {bankSettings.bank_transfer_template?.replace('{order_number}', orderNumber) || `${orderNumber}`}
                        </span>
                      </p>
                   </div>
                   {bankSettings.bank_qr_code && (
                      <div className="bg-white p-2 border border-stone/20 rounded-lg shadow-sm">
                         <img src={bankSettings.bank_qr_code} alt="Mã QR Chuyển khoản" className="w-32 h-32" />
                      </div>
                   )}
                </div>
             </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
            <Link 
              href="/products" 
              className="w-full sm:w-auto px-10 py-4 bg-primary text-white font-display font-bold tracking-widest rounded-full hover:bg-slate-900 transition-all shadow-lg text-center text-sm uppercase"
            >
              Tiếp tục Mua sắm
            </Link>
            <Link 
              href="/" 
              className="w-full sm:w-auto px-10 py-4 border-2 border-accent text-accent font-display font-bold tracking-widest rounded-full hover:bg-accent hover:text-white transition-all text-center text-sm uppercase"
            >
              Về Trang chủ
            </Link>
          </div>
        </div>
        
        {/* Footer Decorative */}
        <div className="bg-stone/5 p-6 text-center border-t border-stone/10">
          <p className="italic font-body text-slate-500 text-sm">
            Mọi thắc mắc vui lòng liên hệ: <span className="text-accent font-bold">1900 1234</span> hoặc <span className="text-accent font-bold">hotro@disangomviet.vn</span>
          </p>
        </div>
      </div>
      
      <style jsx>{`
        .font-display { font-family: 'Playfair Display', serif; }
        .font-body { font-family: 'EB Garamond', serif; }
        .shadow-premium { box-shadow: 0 20px 50px rgba(27, 54, 93, 0.1); }
        .animate-fade-in { animation: fadeIn 0.8s ease-out forwards; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
