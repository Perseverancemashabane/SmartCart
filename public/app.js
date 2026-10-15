/**
 * SmartCart IoT - Full Application Logic (v9)
 * Cart lifecycle + auth + wallet payment + shopping list + review flow
 *
 * v9 changes:
 *  - btn-checkout always opens review screen (no dock shortcut)
 *  - Removed auto-jump to payment when cart is docked
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
    this.inputCartId = document.getElementById('input-cart-id');
    this.btnPairManual = document.getElementById('btn-pair-manual');

    if (this.btnStartQr) this.btnStartQr.addEventListener('click', () => this.openScannerModal());
    if (this.btnCloseQr) this.btnCloseQr.addEventListener('click', () => this.closeScannerModal());
    if (this.btnPairManual) this.btnPairManual.addEventListener('click', () => this.handleManualPairing());
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
          console.warn("Camera access failed:", err);
          this.showCameraFallbackNotice();
        });
        this.isScanning = true;
      } else {
        this.showCameraFallbackNotice();
      }
    } catch (e) {
      console.warn("Camera init exception:", e);
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
          <p style="font-size: 0.78rem; margin-top: 6px;">Please use manual Cart ID entry.</p>
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
    this.triggerPairing(cartId || 'cart_004');
  }
  handleManualPairing() {
    const val = this.inputCartId ? this.inputCartId.value.trim() : '';
    if (!val) {
      appBus.emit('ui:toast', { message: 'Please enter a valid Cart ID', type: 'warning' });
      return;
    }
    this.triggerPairing(val);
  }
  triggerPairing(cartId) {
    this.bus.emit('qr:scanned', { cartId });
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
    this.bus.on('cart:item_added', (data) => {
      this.showToast(`RFID Scanned: + ${data.item.name}`, 'success');
      this.highlightItemCard(data.item.sku, 'flash-add');
    });
    this.bus.on('cart:item_removed', (data) => {
      this.showToast(`Item Removed: ${data.item.name}`, 'info');
      this.highlightItemCard(data.item.sku, 'flash-remove');
    });
    this.bus.on('station:changed', (data) => this.renderStationBanner(data.isDocked));

    if (this.btnCheckout) {
      this.btnCheckout.addEventListener('click', () => {
        if (this.cartModule.items.length === 0) {
          this.showToast('Your cart is empty! Add items before checking out.', 'warning');
          return;
        }
        // ALWAYS show review screen first, regardless of dock state
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
              <div class="item-meta">
                <span>Qty:</span><span class="qty-val">${item.quantity}</span>
              </div>
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
  highlightItemCard(sku, animationClass) {
    const card = document.getElementById(`card-${sku}`);
    if (card) {
      card.classList.remove('flash-add', 'flash-remove');
      void card.offsetWidth;
      card.classList.add(animationClass);
    }
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
        this.checkoutTooltip.innerHTML = '<i class="fa-solid fa-info-circle"></i> Add items using RFID scanner to proceed.';
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
    this.watcherBannerItems.innerHTML = requests
      .map(r => `<span>${r.name}</span>`)
      .join('');
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


// ==========================================================================
// 5. ShoppingListProgressModule
// ==========================================================================
class ShoppingListProgressModule {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.list = null;
    this.expanded = false;
    this.initDOM();
    this.bindEvents();
  }
  initDOM() {
    this.banner = document.getElementById('shopping-list-progress');
    this.toggle = document.getElementById('sl-toggle');
    this.progressText = document.getElementById('sl-progress-text');
    this.percentText = document.getElementById('sl-percent-text');
    this.barFill = document.getElementById('sl-bar-fill');
    this.chevron = document.getElementById('sl-chevron');
    this.itemsContainer = document.getElementById('sl-items');
  }
  bindEvents() {
    if (this.toggle) {
      this.toggle.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.itemsContainer.classList.toggle('open', this.expanded);
        this.chevron.classList.toggle('open', this.expanded);
      });
    }
    this.bus.on('cart:updated', () => {
      if (this.cartModule.cartId) this.loadList();
    });
    this.bus.on('cart:paired', () => this.loadList());
    this.bus.on('cart:unpaired', () => this.hideBanner());
  }
  hideBanner() {
    if (this.banner) this.banner.classList.add('hidden');
    this.list = null;
  }
  async loadList() {
    try {
      const res = await fetch(`${window.API_URL}/api/shopping-list/active`, {
        credentials: 'include'
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.list) { this.hideBanner(); return; }
      this.list = data.list;
      this.render();
    } catch (err) { /* silent */ }
  }
  render() {
    if (!this.list || !this.banner) return;
    const { total, found, progressPercent, items } = this.list;
    if (total === 0) { this.hideBanner(); return; }
    this.banner.classList.remove('hidden');
    this.progressText.textContent = `${found} of ${total} items collected`;
    this.percentText.textContent = `${progressPercent}%`;
    this.barFill.style.width = progressPercent + '%';
    this.itemsContainer.innerHTML = items.map(item => `
      <div class="sl-item ${item.isScanned ? 'done' : ''}">
        <div class="sl-item-check">${item.isScanned ? '<i class="fa-solid fa-check"></i>' : ''}</div>
        <span class="sl-item-name">${item.name}</span>
        <span class="sl-item-qty">×${item.quantity}</span>
      </div>
    `).join('');
  }
}


// ==========================================================================
// 6. ReviewModule — Done Shopping → Review → Confirm & Pay
// ==========================================================================
class ReviewModule {
  constructor(bus, cartModule, ui) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.ui = ui;
    this.initDOM();
    this.bindEvents();
  }
  initDOM() {
    this.reviewModal = document.getElementById('modal-review');
    this.dockWaitModal = document.getElementById('modal-dock-wait');
    this.reviewItems = document.getElementById('review-items');
    this.reviewItemsTitle = document.getElementById('review-items-title');
    this.reviewTotal = document.getElementById('review-total');
    this.reviewRemovals = document.getElementById('review-removals');
    this.reviewRemovalsSection = document.getElementById('review-removals-section');
    this.btnReviewBack = document.getElementById('btn-review-back');
    this.btnReviewConfirm = document.getElementById('btn-review-confirm');
    this.btnDockWaitCancel = document.getElementById('btn-dock-wait-cancel');
  }
  bindEvents() {
    this.bus.on('review:open', () => this.openReview());
    if (this.btnReviewBack) {
      this.btnReviewBack.addEventListener('click', () => {
        this.reviewModal.classList.remove('show');
      });
    }
    if (this.btnReviewConfirm) {
      this.btnReviewConfirm.addEventListener('click', () => this.confirmAndPay());
    }
    if (this.btnDockWaitCancel) {
      this.btnDockWaitCancel.addEventListener('click', () => this.cancelDockWait());
    }
  }
  openReview() {
    const items = this.cartModule.items;
    const removalRequests = this.cartModule.removalRequests;

    this.reviewItemsTitle.textContent = `Items (${items.length})`;
    this.reviewItems.innerHTML = items.map(item => `
      <div class="review-item">
        <span class="review-item-name">${item.quantity}× ${item.name}</span>
        <span class="review-item-price">${CartStateModule.formatCurrency(item.price * item.quantity)}</span>
      </div>
    `).join('');

    if (removalRequests && removalRequests.length > 0) {
      this.reviewRemovalsSection.style.display = 'block';
      this.reviewRemovals.innerHTML = removalRequests.map(r => `
        <div class="review-removal-item">${r.name}</div>
      `).join('');
    } else {
      this.reviewRemovalsSection.style.display = 'none';
    }

    this.reviewTotal.textContent = CartStateModule.formatCurrency(this.cartModule.getTotalAmount());
    this.reviewModal.classList.add('show');
  }
  async confirmAndPay() {
    if (!this.cartModule.cartId) return;

    this.btnReviewConfirm.disabled = true;
    this.btnReviewConfirm.textContent = 'Please wait…';

    try {
      const res = await fetch(`${window.API_URL}/api/cart/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: this.cartModule.cartId })
      });
      const data = await res.json();

      if (!res.ok) {
        this.ui.showToast(data.error || 'Could not confirm payment', 'error');
        this.btnReviewConfirm.disabled = false;
        this.btnReviewConfirm.textContent = 'Confirm & Pay';
        return;
      }

      // If the cart is already docked, go straight to payment modal
      // Otherwise show the dock-wait modal
      this.reviewModal.classList.remove('show');

      if (this.cartModule.isDockedAtStation) {
        this.bus.emit('checkout:open_modal');
      } else {
        this.dockWaitModal.classList.add('show');
      }
    } catch (err) {
      console.error('[confirm-payment] error:', err);
      this.ui.showToast('Network error', 'error');
    } finally {
      this.btnReviewConfirm.disabled = false;
      this.btnReviewConfirm.textContent = 'Confirm & Pay';
    }
  }
  async cancelDockWait() {
    if (!this.cartModule.cartId) return;

    this.btnDockWaitCancel.disabled = true;
    this.btnDockWaitCancel.textContent = 'Cancelling…';

    try {
      const res = await fetch(`${window.API_URL}/api/cart/cancel-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: this.cartModule.cartId })
      });
      const data = await res.json();

      if (!res.ok) {
        this.ui.showToast(data.error || 'Could not cancel', 'error');
        return;
      }

      this.dockWaitModal.classList.remove('show');
      this.ui.showToast('You can continue shopping', 'info');
    } catch (err) {
      console.error('[cancel-payment] error:', err);
      this.ui.showToast('Network error', 'error');
    } finally {
      this.btnDockWaitCancel.disabled = false;
      this.btnDockWaitCancel.textContent = 'Cancel and continue shopping';
    }
  }
  onDocked() {
    if (this.dockWaitModal.classList.contains('show')) {
      this.dockWaitModal.classList.remove('show');
      this.bus.emit('checkout:open_modal');
    }
  }
}


// ==========================================================================
// 7. CheckoutModule
// ==========================================================================
class CheckoutModule {
  constructor(bus, cartModule, ui) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.ui = ui;
    this.pinBuffer = '';
    this.pinMaxLength = 6;
    this.initDOM();
    this.bindEvents();
  }
  initDOM() {
    this.methodModal = document.getElementById('modal-payment-method');
    this.pinModal = document.getElementById('modal-pin');
    this.receiptModal = document.getElementById('modal-receipt');
    this.modalTotalValue = document.getElementById('modal-total-value');
    this.pinAmountDisplay = document.getElementById('pin-amount-display');
    this.pinDisplay = document.getElementById('pin-display');
    this.pinError = document.getElementById('pin-error');
    this.pinNumpad = document.getElementById('pin-numpad');
    this.btnPayWallet = document.getElementById('btn-pay-wallet');
    this.btnPayPaystack = document.getElementById('btn-pay-paystack');
    this.btnCancelPayment = document.getElementById('btn-cancel-payment');
    this.btnCancelPin = document.getElementById('btn-cancel-pin');
    this.receiptOrderRef = document.getElementById('receipt-order-ref');
    this.receiptTimestamp = document.getElementById('receipt-timestamp');
    this.receiptItemsList = document.getElementById('receipt-items-list');
    this.receiptSubtotal = document.getElementById('receipt-subtotal');
    this.receiptVat = document.getElementById('receipt-vat');
    this.receiptTotal = document.getElementById('receipt-total');
    this.receiptMethodLabel = document.getElementById('receipt-method-label');
    this.btnFinishReset = document.getElementById('btn-finish-reset');
  }
  bindEvents() {
    this.bus.on('checkout:open_modal', () => this.openMethodModal());
    if (this.btnPayWallet) this.btnPayWallet.addEventListener('click', () => this.openPinModal());
    if (this.btnPayPaystack) this.btnPayPaystack.addEventListener('click', () => this.payWithPaystack());
    if (this.btnCancelPayment) this.btnCancelPayment.addEventListener('click', () => this.closeMethodModal());
    if (this.btnCancelPin) this.btnCancelPin.addEventListener('click', () => this.closePinModal());
    if (this.btnFinishReset) this.btnFinishReset.addEventListener('click', () => this.resetAndFinish());
    if (this.pinNumpad) {
      this.pinNumpad.querySelectorAll('.pin-key').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-key');
          if (key === 'clear') this.clearPinDigit();
          else if (key === 'confirm') this.submitPin();
          else this.addPinDigit(key);
        });
      });
    }
  }
  openMethodModal() {
    const total = CartStateModule.formatCurrency(this.cartModule.getTotalAmount());
    if (this.modalTotalValue) this.modalTotalValue.textContent = total;
    if (this.methodModal) this.methodModal.classList.add('show');
  }
  closeMethodModal() { if (this.methodModal) this.methodModal.classList.remove('show'); }
  openPinModal() {
    this.closeMethodModal();
    this.pinBuffer = '';
    this.pinError.textContent = '';
    const total = CartStateModule.formatCurrency(this.cartModule.getTotalAmount());
    if (this.pinAmountDisplay) this.pinAmountDisplay.textContent = total;
    this.renderPinDisplay();
    if (this.pinModal) this.pinModal.classList.add('show');
  }
  closePinModal() {
    if (this.pinModal) this.pinModal.classList.remove('show');
    this.pinBuffer = '';
  }
  addPinDigit(digit) {
    if (this.pinBuffer.length >= this.pinMaxLength) return;
    this.pinBuffer += digit;
    this.pinError.textContent = '';
    this.renderPinDisplay();
  }
  clearPinDigit() {
    this.pinBuffer = this.pinBuffer.slice(0, -1);
    this.renderPinDisplay();
  }
  renderPinDisplay() {
    if (!this.pinDisplay) return;
    const len = Math.max(4, this.pinBuffer.length + 1);
    this.pinDisplay.innerHTML = '';
    for (let i = 0; i < len; i++) {
      const div = document.createElement('div');
      div.className = 'pin-digit';
      if (i < this.pinBuffer.length) {
        div.classList.add('filled');
        div.textContent = '●';
      } else if (i === this.pinBuffer.length) {
        div.classList.add('active');
      }
      this.pinDisplay.appendChild(div);
    }
    const confirmBtn = this.pinNumpad.querySelector('.pin-key.confirm');
    if (confirmBtn) confirmBtn.disabled = this.pinBuffer.length < 4;
  }
  async submitPin() {
    if (this.pinBuffer.length < 4) return;
    const pin = this.pinBuffer;
    this.pinError.textContent = '';
    const confirmBtn = this.pinNumpad.querySelector('.pin-key.confirm');
    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const res = await fetch(`${window.API_URL}/api/wallet/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: this.cartModule.cartId, pin })
      });
      const data = await res.json();
      if (!res.ok) {
        this.pinError.textContent = data.error || 'Payment failed';
        this.pinBuffer = '';
        this.renderPinDisplay();
        return;
      }
      this.closePinModal();
      this.showReceipt('Wallet', data);
      try {
        await fetch(`${window.API_URL}/api/shopping-list/complete`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (e) { /* silent */ }
    } catch (err) {
      console.error('[Wallet pay] error:', err);
      this.pinError.textContent = 'Network error. Please try again.';
      this.pinBuffer = '';
      this.renderPinDisplay();
    }
  }
  async payWithPaystack() {
    this.closeMethodModal();
    this.ui.showToast('Redirecting to Paystack...', 'info');
    try {
      const res = await fetch(`${window.API_URL}/api/checkout/create-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: this.cartModule.cartId })
      });
      const data = await res.json();
      if (data.success && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        this.ui.showToast(data.error || 'Payment failed to start', 'error');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      this.ui.showToast('Payment initialization failed', 'error');
    }
  }
  showReceipt(method, data) {
    const summary = this.cartModule.getStateSummary();
    const orderNum = 'ORD-' + Math.floor(1000 + Math.random() * 9000) + '-ZAR';
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
    if (this.receiptOrderRef) this.receiptOrderRef.textContent = `REF: #${orderNum}`;
    if (this.receiptTimestamp) this.receiptTimestamp.textContent = now;
    if (this.receiptMethodLabel) this.receiptMethodLabel.textContent = `Paid via ${method}`;
    if (this.receiptItemsList) {
      this.receiptItemsList.innerHTML = summary.items.map(item => `
        <div class="receipt-item-row">
          <span>${item.quantity}x ${item.name}</span>
          <span>${CartStateModule.formatCurrency(item.price * item.quantity)}</span>
        </div>
      `).join('');
    }
    if (this.receiptSubtotal) this.receiptSubtotal.textContent = CartStateModule.formatCurrency(summary.subtotal);
    if (this.receiptVat) this.receiptVat.textContent = CartStateModule.formatCurrency(summary.vatAmount);
    if (this.receiptTotal) this.receiptTotal.textContent = CartStateModule.formatCurrency(summary.totalAmount);
    if (this.receiptModal) this.receiptModal.classList.remove('hidden');
    this.ui.showToast('Payment Successful!', 'success');
  }
  async resetAndFinish() {
    if (this.receiptModal) this.receiptModal.classList.add('hidden');
    if (this.cartModule.cartId) {
      try {
        await fetch(`${window.API_URL}/api/cart/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cart_id: this.cartModule.cartId })
        });
      } catch (err) { console.warn('[Reset] error:', err); }
    }
    this.cartModule.setDockedState(false);
    this.cartModule.unpairCart();
  }
}


// ==========================================================================
// 8. MockLiveFeedModule (Dev panel)
// ==========================================================================
class MockLiveFeedModule {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.isExpanded = false;
    this.products = [];
    this.initDOM();
    this.bindEvents();
    this.loadProducts();
  }
  initDOM() {
    this.debugPanel = document.getElementById('debug-panel');
    this.debugHandle = document.getElementById('debug-handle');
    this.debugToggleText = document.getElementById('debug-toggle-text');
    this.debugChevron = document.getElementById('debug-chevron');
    this.simBtnToggleDock = document.getElementById('sim-btn-toggle-dock');
    this.simDockText = document.getElementById('sim-dock-text');
    this.debugEventLog = document.getElementById('debug-event-log');
    this.simItemsButtons = document.getElementById('sim-items-buttons');
    if (this.debugPanel) this.debugPanel.style.display = 'none';

    const devBtn = document.createElement('button');
    devBtn.id = 'dev-panel-toggle';
    devBtn.innerHTML = '<i class="fa-solid fa-microchip"></i> Dev';
    devBtn.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      padding: 10px 16px; background: #f59e0b; color: #0f172a;
      border: none; border-radius: 24px; font-size: 0.85rem;
      font-weight: 700; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
      font-family: inherit; display: flex; align-items: center; gap: 6px;
    `;
    document.body.appendChild(devBtn);
  }
  async loadProducts() {
    if (!this.simItemsButtons) return;
    try {
      const res = await fetch(`${window.API_URL}/api/products/list`);
      const data = await res.json();
      if (!data.success || !data.products || data.products.length === 0) {
        this.simItemsButtons.innerHTML = `<div class="sim-empty">No products in database.</div>`;
        return;
      }
      this.products = data.products;
      this.simItemsButtons.innerHTML = data.products.map(p => `
        <button class="sim-add-btn" data-rfid="${p.rfidTag || ''}" data-name="${p.name}">
          + ${p.name}<br><span style="color:#94a3b8;font-size:0.7rem;">R${p.priceRands}</span>
        </button>
      `).join('');
      this.simItemsButtons.querySelectorAll('.sim-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const rfid = e.currentTarget.getAttribute('data-rfid');
          const name = e.currentTarget.getAttribute('data-name');
          if (!rfid) {
            this.bus.emit('ui:toast', { message: 'Product has no tag', type: 'error' });
            return;
          }
          await this.scanItem(rfid, name);
        });
      });
    } catch (err) {
      console.error('Failed to load products:', err);
      this.simItemsButtons.innerHTML = `<div class="sim-error">Failed to load products.</div>`;
    }
  }
  async scanItem(rfidTag, name) {
    if (!this.cartModule.cartId) {
      this.bus.emit('ui:toast', { message: 'Pair a cart first', type: 'warning' });
      return;
    }
    try {
      const res = await fetch(`${window.API_URL}/api/hardware/scan-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cart_id: this.cartModule.cartId,
          rfid_tag: rfidTag,
          action: 'toggle'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        this.bus.emit('ui:toast', { message: data.error || 'Scan failed', type: 'error' });
        return;
      }
      const action = data.session?.lastAction?.action || 'added';
      this.bus.emit('ui:toast', {
        message: `${action === 'added' ? 'Added' : 'Removed'}: ${name}`,
        type: action === 'added' ? 'success' : 'info'
      });
    } catch (err) {
      console.error('Scan error:', err);
      this.bus.emit('ui:toast', { message: 'Network error', type: 'error' });
    }
  }
  bindEvents() {
    if (this.debugHandle) this.debugHandle.addEventListener('click', () => this.togglePanel());
    const devBtn = document.getElementById('dev-panel-toggle');
    if (devBtn) devBtn.addEventListener('click', () => this.togglePanel());

    if (this.simBtnToggleDock) {
      this.simBtnToggleDock.addEventListener('click', async () => {
        const cartId = this.cartModule.cartId;
        if (!cartId) {
          this.bus.emit('ui:toast', { message: 'Pair a cart first', type: 'warning' });
          return;
        }
        const isCurrentlyDocked = this.cartModule.isDockedAtStation;
        const endpoint = isCurrentlyDocked ? 'station-undock' : 'station-dock';
        this.simBtnToggleDock.disabled = true;
        this.simBtnToggleDock.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Working...';
        try {
          const res = await fetch(`${window.API_URL}/api/hardware/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              station_id: 'STATION_BASE_01',
              cart_rfid_tag: cartId,
              cart_id: cartId
            })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            this.bus.emit('ui:toast', { message: data.error || 'Dock failed', type: 'error' });
          } else {
            const newDocked = Boolean(data.session?.isDocked);
            this.cartModule.setDockedState(newDocked);
            this.bus.emit('ui:toast', {
              message: newDocked ? 'Cart docked' : 'Cart undocked',
              type: 'success'
            });
          }
        } catch (err) {
          console.error('Dock toggle error:', err);
          this.bus.emit('ui:toast', { message: 'Network error', type: 'error' });
        } finally {
          this.simBtnToggleDock.disabled = false;
          const currently = this.cartModule.isDockedAtStation;
          this.simBtnToggleDock.innerHTML = currently
            ? '<i class="fa-solid fa-plug"></i> Undock Cart'
            : '<i class="fa-solid fa-plug"></i> Simulate Station Docking (Unlock Pay)';
        }
      });
    }
    const rmBtn = document.getElementById('sim-remove-random');
    if (rmBtn) rmBtn.addEventListener('click', () => this.cartModule.removeLastItem());
    const clrBtn = document.getElementById('sim-clear-all');
    if (clrBtn) clrBtn.addEventListener('click', () => this.cartModule.clearCart());
  }
  togglePanel() {
    if (!this.debugPanel) return;
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
      this.debugPanel.style.display = 'block';
      this.debugPanel.classList.remove('collapsed');
      if (this.debugToggleText) this.debugToggleText.textContent = 'Collapse Controls';
    } else {
      this.debugPanel.style.display = 'none';
      this.debugPanel.classList.add('collapsed');
      if (this.debugToggleText) this.debugToggleText.textContent = 'Expand Controls';
    }
  }
}


// ==========================================================================
// 9. Auth Module
// ==========================================================================
class AuthModule {
  constructor(bus) {
    this.bus = bus;
    this.customer = null;
    this.loginGate = document.getElementById('login-gate');
    this.init();
  }
  async init() { await this.loadAuth(); }
  async loadAuth() {
    const badge1 = document.getElementById('auth-badge-pairing');
    const badge2 = document.getElementById('auth-badge-cart');
    try {
      const res = await fetch(`${window.API_URL}/api/auth/me`, { credentials: 'include' });
      const data = await res.json();
      if (data.authenticated && data.customer) {
        this.customer = data.customer;
        this.hideLoginGate();
      } else {
        this.customer = null;
        this.showLoginGate();
      }
      this.renderAuthBadge(badge1);
      this.renderAuthBadge(badge2);
    } catch (err) {
      console.error('Auth check failed:', err);
      this.showLoginGate();
    }
  }
  showLoginGate() { if (this.loginGate) this.loginGate.classList.add('show'); }
  hideLoginGate() { if (this.loginGate) this.loginGate.classList.remove('show'); }
  renderAuthBadge(container) {
    if (!container) return;
    if (!this.customer) { container.innerHTML = ''; return; }
    const c = this.customer;
    const displayName = c.name || c.phoneNumber;
    const wallet = c.walletBalanceRands || (c.walletBalanceCents / 100).toFixed(2);
    container.innerHTML = `
      <a href="/wallet.html" class="user-badge" style="text-decoration: none;">
        <i class="fa-solid fa-user-circle"></i>
        <span>${displayName}</span>
        <span class="wallet-pill"><i class="fa-solid fa-wallet"></i> R ${wallet}</span>
      </a>
      <a href="/list.html" class="btn-list-link" title="My Shopping List">
        <i class="fa-solid fa-list-check"></i>
        <span class="list-link-text">My List</span>
      </a>
      <button class="btn-logout" id="btn-logout-${container.id}">
        <i class="fa-solid fa-right-from-bracket"></i> Logout
      </button>
    `;
    const logoutBtn = document.getElementById(`btn-logout-${container.id}`);
    if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());
  }
  async logout() {
    try {
      if (window.cartModule && window.cartModule.cartId) {
        try {
          await fetch(`${window.API_URL}/api/cart/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cart_id: window.cartModule.cartId })
          });
        } catch (e) { console.warn('Cart reset on logout failed:', e); }
      }
      await fetch(`${window.API_URL}/api/auth/logout`, {
        method: 'POST', credentials: 'include'
      });
      window.location.href = '/login.html';
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }
}


// ==========================================================================
// 10. App Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  const isLocalhost = window.location.hostname === 'localhost';
  window.API_URL = isLocalhost ? 'http://localhost:3000' : 'https://smart-cart-5qod.vercel.app';

  const cartModule = new CartStateModule(appBus);
  window.cartModule = cartModule;

  const qrScanner = new QRScannerModule(appBus);
  const uiController = new UIController(appBus, cartModule);
  const shoppingListProgress = new ShoppingListProgressModule(appBus, cartModule);
  const reviewModule = new ReviewModule(appBus, cartModule, uiController);
  const checkoutModule = new CheckoutModule(appBus, cartModule, uiController);
  const mockFeed = new MockLiveFeedModule(appBus, cartModule);
  const authModule = new AuthModule(appBus);

  // Auto-pair from URL
  const urlParams = new URLSearchParams(window.location.search);
  let urlCartId = urlParams.get('cart_id');

  if (!urlCartId && window.location.hash) {
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    urlCartId = hashParams.get('cart');
  }

  if (urlCartId) {
    localStorage.setItem('pendingCartId', urlCartId);
  } else {
    const saved = localStorage.getItem('pendingCartId');
    if (saved) urlCartId = saved;
  }

  if (urlCartId) {
    const cartInput = document.getElementById('input-cart-id');
    if (cartInput) cartInput.value = urlCartId;

    setTimeout(() => {
      if (authModule.customer) {
        appBus.emit('qr:scanned', { cartId: urlCartId });
        localStorage.removeItem('pendingCartId');
      } else {
        const checkLogin = setInterval(() => {
          if (authModule.customer) {
            clearInterval(checkLogin);
            appBus.emit('qr:scanned', { cartId: urlCartId });
            localStorage.removeItem('pendingCartId');
          }
        }, 1000);
      }
    }, 800);
  }

  appBus.on('qr:scanned', async (data) => {
    try {
      const res = await fetch(`${window.API_URL}/api/cart/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: data.cartId })
      });
      const result = await res.json();
      if (!res.ok) {
        appBus.emit('ui:toast', { message: result.error || 'Pairing failed', type: 'error' });
        return;
      }
      cartModule.pairCart(data.cartId);
    } catch (err) {
      console.error('[Pair] Fetch failed:', err);
      appBus.emit('ui:toast', { message: 'Pairing failed', type: 'error' });
    }
  });

  appBus.on('cart:paired', () => {
    localStorage.removeItem('pendingCartId');
  });

  let lastServerSignature = '';
  let lastDockedState = false;

  function applyServerSession(session) {
    if (!session) {
      if (cartModule.items.length > 0 || cartModule.isDockedAtStation) {
        cartModule.items = [];
        cartModule.removalRequests = [];
        cartModule.setDockedState(false);
        lastServerSignature = '';
        appBus.emit('cart:updated', cartModule.getStateSummary());
      }
      return;
    }

    const serverItems = (session.items || []).map(item => ({
      sku: item.sku,
      name: item.name,
      price: item.unitPriceCents ? (item.unitPriceCents / 100) : parseFloat(item.price || 0),
      quantity: item.quantity,
      icon: 'fa-box'
    }));
    const sig = JSON.stringify(serverItems.map(i => `${i.sku}|${i.price}|${i.quantity}`));
    if (sig !== lastServerSignature) {
      lastServerSignature = sig;
      cartModule.items = serverItems;
    }

    cartModule.removalRequests = (session.items || [])
      .filter(i => i.removeRequestedAt)
      .map(i => ({ id: i.id, sku: i.sku, name: i.name }));

    const nowDocked = Boolean(session.isDocked);
    const wasDocked = lastDockedState;
    lastDockedState = nowDocked;
    cartModule.setDockedState(nowDocked);

    if (nowDocked && !wasDocked) {
      reviewModule.onDocked();
    }

    appBus.emit('cart:updated', cartModule.getStateSummary());
  }

  async function pollCart() {
    if (cartModule.cartId) {
      try {
        const res = await fetch(`${window.API_URL}/api/cart/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cart_id: cartModule.cartId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) applyServerSession(data.session);
        }
      } catch (err) { /* silent */ }
    }
    setTimeout(pollCart, 2000);
  }
  appBus.on('cart:paired', () => { lastServerSignature = ''; });
  appBus.on('cart:unpaired', () => { lastServerSignature = ''; });
  pollCart();

  // Paystack callback
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
          appBus.emit('ui:toast', {
            message: verifyData.error || 'Payment verification failed',
            type: 'error'
          });
          return;
        }

        try {
          await fetch(`${window.API_URL}/api/shopping-list/complete`, {
            method: 'POST',
            credentials: 'include'
          });
        } catch (e) { /* silent */ }

        await fetch(`${window.API_URL}/api/cart/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cart_id: paidCartId })
        });

        window.history.replaceState({}, '', window.location.pathname);
        appBus.emit('ui:toast', {
          message: `Payment successful! R ${verifyData.amountRands} received.`,
          type: 'success'
        });
      } catch (err) {
        console.error('[Paystack] Verify flow failed:', err);
        appBus.emit('ui:toast', {
          message: 'Payment verification failed',
          type: 'error'
        });
      }
    })();
  }

  console.log('SmartCart ready. API:', window.API_URL);
});