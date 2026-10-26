/**
 * SmartCart IoT - Full Application Logic (v13)
 * Fixed: Paystack callback now clears local state properly to prevent bounce-back.
 */

// ==========================================================================
// 1. EventBus
// ==========================================================================
class EventBus {
  constructor() { this.events = {}; }
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }
  off(event, listenerToRemove) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listenerToRemove);
  }
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(data));
  }
}
const appBus = new EventBus();


// ==========================================================================
// 2. CartStateModule
// ==========================================================================
class CartStateModule {
  constructor(bus) {
    this.bus = bus;
    this.cartId = null;
    this.items = [];
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid';
    this.vatRate = 0.15;
    this.removalRequests = [];
  }
  pairCart(id) {
    this.cartId = id;
    this.items = [];
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid';
    this.removalRequests = [];
    this.bus.emit('cart:paired', { cartId: this.cartId });
  }
  unpairCart() {
    const prevId = this.cartId;
    this.cartId = null;
    this.items = [];
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid';
    this.removalRequests = [];
    this.bus.emit('cart:unpaired', { cartId: prevId });
  }
  clearCart() {
    this.items = [];
    this.bus.emit('cart:updated', this.getStateSummary());
  }
  setDockedState(isDocked) {
    const newState = Boolean(isDocked);
    if (this.isDockedAtStation === newState) return;
    this.isDockedAtStation = newState;
    this.bus.emit('station:changed', { isDocked: this.isDockedAtStation });
  }
  toggleDockedState() { this.setDockedState(!this.isDockedAtStation); }
  getSubtotal() { return this.items.reduce((s, i) => s + i.price * i.quantity, 0); }
  getVatAmount() { return this.getSubtotal() * this.vatRate; }
  getTotalAmount() { return this.getSubtotal() + this.getVatAmount(); }
  getItemCount() { return this.items.reduce((c, i) => c + i.quantity, 0); }
  getStateSummary() {
    return {
      cartId: this.cartId,
      items: [...this.items],
      itemCount: this.getItemCount(),
      subtotal: this.getSubtotal(),
      vatAmount: this.getVatAmount(),
      totalAmount: this.getTotalAmount(),
      isDocked: this.isDockedAtStation,
      paymentStatus: this.paymentStatus
    };
  }
  static formatCurrency(amount) {
    const num = parseFloat(amount || 0);
    return 'R ' + num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  }
}


// ==========================================================================
// 3. QR Scanner
// ==========================================================================
class QRScannerModule {
  constructor(bus) {
    this.bus = bus;
    this.html5QrcodeScanner = null;
    this.isScanning = false;
    this.initUI();
  }
  initUI() {
    this.btnStartQr = document.getElementById('btn-start-qr');
    this.btnCloseQr = document.getElementById('btn-close-qr');
    this.qrModal = document.getElementById('qr-modal');

    if (this.btnStartQr) this.btnStartQr.addEventListener('click', () => this.openScannerModal());
    if (this.btnCloseQr) this.btnCloseQr.addEventListener('click', () => this.closeScannerModal());
  }
  openScannerModal() {
    if (!this.qrModal) return;
    this.qrModal.classList.remove('hidden');
    try {
      if (typeof Html5Qrcode !== 'undefined') {
        this.html5QrcodeScanner = new Html5Qrcode("qr-reader");
        this.html5QrcodeScanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => this.onScanSuccess(decodedText),
          () => {}
        ).catch(err => {
          this.showCameraFallbackNotice();
        });
        this.isScanning = true;
      } else {
        this.showCameraFallbackNotice();
      }
    } catch (e) {
      this.showCameraFallbackNotice();
    }
  }
  showCameraFallbackNotice() {
    const readerEl = document.getElementById('qr-reader');
    if (readerEl) {
      readerEl.innerHTML = `
        <div style="padding: 30px; text-align: center; color: #94a3b8;">
          <i class="fa-solid fa-camera-slash" style="font-size: 36px; margin-bottom: 12px; color: #f59e0b;"></i>
          <p style="font-size: 0.9rem; font-weight: 600; color: #fff;">Camera Access Unavailable</p>
        </div>
      `;
    }
  }
  closeScannerModal() {
    if (this.isScanning && this.html5QrcodeScanner) {
      this.html5QrcodeScanner.stop().then(() => {
        this.html5QrcodeScanner.clear();
        this.isScanning = false;
      }).catch(err => console.warn(err));
    }
    if (this.qrModal) this.qrModal.classList.add('hidden');
  }
  onScanSuccess(decodedText) {
    this.closeScannerModal();
    let cartId = decodedText.trim();
    if (cartId.includes('cart_id=')) {
      cartId = cartId.split('cart_id=')[1].split('&')[0];
    }
    this.bus.emit('qr:scanned', { cartId: cartId || 'cart_004' });
  }
}


// ==========================================================================
// 4. UIController
// ==========================================================================
class UIController {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.initDOM();
    this.bindEvents();
  }
  initDOM() {
    this.viewPairing = document.getElementById('view-pairing');
    this.viewCart = document.getElementById('view-cart');
    this.pairedCartIdDisplay = document.getElementById('paired-cart-id-display');
    this.btnDisconnect = document.getElementById('btn-disconnect');
    this.itemCountBadge = document.getElementById('cart-item-count-badge');
    this.emptyCartState = document.getElementById('empty-cart-state');
    this.cartItemsContainer = document.getElementById('cart-items-container');
    this.summarySubtotal = document.getElementById('summary-subtotal');
    this.summaryVat = document.getElementById('summary-vat');
    this.summaryTotal = document.getElementById('summary-total');
    this.stationStatusBanner = document.getElementById('station-status-banner');
    this.stationIcon = document.getElementById('station-icon');
    this.stationStatusText = document.getElementById('station-status-text');
    this.stationBadge = document.getElementById('station-badge');
    this.btnCheckout = document.getElementById('btn-checkout');
    this.checkoutBtnIcon = document.getElementById('checkout-btn-icon');
    this.checkoutBtnText = document.getElementById('checkout-btn-text');
    this.checkoutTooltip = document.getElementById('checkout-tooltip');
    this.toastContainer = document.getElementById('toast-container');
    this.watcherBanner = document.getElementById('watcher-banner');
    this.watcherBannerItems = document.getElementById('watcher-banner-items');
  }
  bindEvents() {
    this.bus.on('cart:paired', (data) => {
      if (this.pairedCartIdDisplay) {
        const shortId = data.cartId.replace(/^cart_/i, '');
        this.pairedCartIdDisplay.textContent = `Cart #${shortId}`;
      }
      this.switchView('view-cart');
      this.showToast(`Successfully paired with ${data.cartId}`, 'success');
      this.renderStationBanner(this.cartModule.isDockedAtStation);
    });
    this.bus.on('cart:unpaired', () => {
      this.switchView('view-pairing');
      this.showToast('Cart unpaired successfully', 'info');
    });
    if (this.btnDisconnect) {
      this.btnDisconnect.addEventListener('click', async () => {
        const cartId = this.cartModule.cartId;
        if (cartId) {
          try {
            await fetch(`${window.API_URL}/api/cart/reset`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ cart_id: cartId })
            });
          } catch (err) { console.warn('[Unpair] error:', err); }
        }
        this.cartModule.setDockedState(false);
        this.cartModule.unpairCart();
      });
    }
    this.bus.on('cart:updated', (state) => this.renderCartState(state));
    this.bus.on('station:changed', (data) => this.renderStationBanner(data.isDocked));

    if (this.btnCheckout) {
      this.btnCheckout.addEventListener('click', () => {
        if (this.cartModule.items.length === 0) {
          this.showToast('Your cart is empty!', 'warning');
          return;
        }
        appBus.emit('review:open');
      });
    }
    this.bus.on('ui:toast', (data) => this.showToast(data.message, data.type));
  }
  switchView(targetViewId) {
    [this.viewPairing, this.viewCart].forEach(view => {
      if (!view) return;
      if (view.id === targetViewId) {
        view.classList.remove('hidden');
        view.classList.add('view-active');
      } else {
        view.classList.add('hidden');
        view.classList.remove('view-active');
      }
    });
  }
  renderCartState(state) {
    if (this.itemCountBadge) {
      this.itemCountBadge.textContent = `${state.itemCount} ${state.itemCount === 1 ? 'item' : 'items'}`;
    }
    if (state.items.length === 0) {
      if (this.emptyCartState) this.emptyCartState.classList.remove('hidden');
      if (this.cartItemsContainer) {
        this.cartItemsContainer.classList.add('hidden');
        this.cartItemsContainer.innerHTML = '';
      }
    } else {
      if (this.emptyCartState) this.emptyCartState.classList.add('hidden');
      if (this.cartItemsContainer) {
        this.cartItemsContainer.classList.remove('hidden');
        this.renderItemsList(state.items);
      }
    }
    if (this.summarySubtotal) this.summarySubtotal.textContent = CartStateModule.formatCurrency(state.subtotal);
    if (this.summaryVat) this.summaryVat.textContent = CartStateModule.formatCurrency(state.vatAmount);
    if (this.summaryTotal) this.summaryTotal.textContent = CartStateModule.formatCurrency(state.totalAmount);
    this.updateCheckoutButtonState(state.isDocked, state.items.length > 0);
    this.renderWatcherBanner();
  }
  renderItemsList(items) {
    if (!this.cartItemsContainer) return;
    this.cartItemsContainer.innerHTML = items.map(item => {
      const subtotal = item.price * item.quantity;
      const hasRemovalRequest = this.cartModule.removalRequests.some(r => r.sku === item.sku);
      return `
        <div class="cart-item-card${hasRemovalRequest ? ' remove-requested' : ''}" id="card-${item.sku}">
          <div class="item-left">
            <div class="item-icon-box"><i class="fa-solid ${item.icon || 'fa-box'}"></i></div>
            <div class="item-details">
              <h4>${item.name}</h4>
              <div class="item-meta"><span>Qty:</span><span class="qty-val">${item.quantity}</span></div>
            </div>
          </div>
          <div class="item-right">
            <div class="item-pricing">
              <span class="item-subtotal-val">${CartStateModule.formatCurrency(subtotal)}</span>
              <span class="item-unit-price">${CartStateModule.formatCurrency(item.price)} ea</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }
  renderStationBanner(isDocked) {
    if (!this.stationStatusBanner) return;
    if (isDocked) {
      this.stationStatusBanner.className = 'station-banner docked';
      if (this.stationIcon) this.stationIcon.className = 'fa-solid fa-bolt-lightning';
      if (this.stationStatusText) this.stationStatusText.textContent = 'At Base Station / Ready to Pay ⚡';
      if (this.stationBadge) this.stationBadge.textContent = 'Docked';
    } else {
      this.stationStatusBanner.className = 'station-banner in-aisle';
      if (this.stationIcon) this.stationIcon.className = 'fa-solid fa-cart-flatbed-suitcases';
      if (this.stationStatusText) this.stationStatusText.textContent = 'In Aisle / Roaming 🛒';
      if (this.stationBadge) this.stationBadge.textContent = 'Roaming';
    }
    this.updateCheckoutButtonState(isDocked, this.cartModule.items.length > 0);
  }
  updateCheckoutButtonState(isDocked, hasItems) {
    if (!this.btnCheckout) return;
    if (hasItems) {
      this.btnCheckout.disabled = false;
      this.btnCheckout.className = 'btn btn-primary btn-block btn-lg btn-glow';
      if (this.checkoutBtnIcon) this.checkoutBtnIcon.className = 'fa-solid fa-bag-shopping';
      if (this.checkoutBtnText) this.checkoutBtnText.textContent = 'Done Shopping';
      if (this.checkoutTooltip) this.checkoutTooltip.classList.add('hidden');
    } else {
      this.btnCheckout.disabled = true;
      this.btnCheckout.className = 'btn btn-primary btn-block btn-lg btn-locked';
      if (this.checkoutBtnIcon) this.checkoutBtnIcon.className = 'fa-solid fa-lock';
      if (this.checkoutBtnText) this.checkoutBtnText.textContent = 'Cart is Empty';
      if (this.checkoutTooltip) {
        this.checkoutTooltip.classList.remove('hidden');
        this.checkoutTooltip.innerHTML = '<i class="fa-solid fa-info-circle"></i> Add items to proceed.';
      }
    }
  }
  renderWatcherBanner() {
    if (!this.watcherBanner || !this.watcherBannerItems) return;
    const requests = this.cartModule.removalRequests;
    if (!requests || requests.length === 0) {
      this.watcherBanner.classList.add('hidden');
      return;
    }
    this.watcherBanner.classList.remove('hidden');
    this.watcherBannerItems.innerHTML = requests.map(r => `<span>${r.name}</span>`).join('');
  }
  showToast(message, type = 'info') {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${message}</span>`;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

// ... (Include the rest of the classes: ShoppingListProgressModule, ReviewModule, CheckoutModule, MockLiveFeedModule, AuthModule) ...
// Since the file is long, I am providing the exact fix for the bottom of the file.

document.addEventListener('DOMContentLoaded', () => {
  const isLocalhost = window.location.hostname === 'localhost';
  window.API_URL = isLocalhost ? 'http://localhost:3000' : 'https://smart-cart-5qod.vercel.app';

  const cartModule = new CartStateModule(appBus);
  window.cartModule = cartModule;

  const qrScanner = new QRScannerModule(appBus);
  const uiController = new UIController(appBus, cartModule);
  // ... initialize other modules ...

  // Paystack callback
  const urlParams = new URLSearchParams(window.location.search);
  const paid = urlParams.get('paid');
  const paidCartId = urlParams.get('cart_id');
  const paidReference = urlParams.get('reference');

  if (paid === 'true' && paidCartId && paidReference) {
    (async () => {
      try {
        const verifyRes = await fetch(`${window.API_URL}/api/checkout/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reference: paidReference })
        });
        const verifyData = await verifyRes.json();

        if (!verifyRes.ok) {
          console.error('[Paystack verify] Failed:', verifyData.error);
          appBus.emit('ui:toast', { message: verifyData.error || 'Payment verification failed', type: 'error' });
          return;
        }

        // 1. Remove URL params so refresh doesn't run this again
        window.history.replaceState({}, '', window.location.pathname);

        // 2. Force a clean reset of the UI
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal) receiptModal.classList.add('hidden');
        
        cartModule.setDockedState(false);
        cartModule.clearCart(); // clears local items
        cartModule.unpairCart(); // moves back to pairing screen

        // 3. Show success toast
        appBus.emit('ui:toast', {
          message: `Payment successful! R ${verifyData.amountRands} received.`,
          type: 'success'
        });
      } catch (err) {
        console.error('[Paystack] Verify flow failed:', err);
        appBus.emit('ui:toast', { message: 'Payment verification failed', type: 'error' });
      }
    })();
  }
});