/**
 * SmartCart IoT - Full Application Logic (v11)
 * Removed Dev Button, cleaned up polling
 */

class EventBus {
  constructor() { this.events = {}; }
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(data));
  }
}
const appBus = new EventBus();

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
      const res = await fetch(`${window.API_URL}/api/shopping-list/active`, { credentials: 'include' });
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
      this.reviewRemovals.innerHTML = removalRequests.map(r => `<div class="review-removal-item">${r.name}</div>`).join('');
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
        return;
      }
      this.reviewModal.classList.remove('show');
      if (this.cartModule.isDockedAtStation) {
        this.bus.emit('checkout:open_modal');
      } else {
        this.dockWaitModal.classList.add('show');
      }
    } catch (err) {
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
      await fetch(`${window.API_URL}/api/cart/cancel-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cart_id: this.cartModule.cartId })
      });
      this.dockWaitModal.classList.remove('show');
      this.ui.showToast('You can continue shopping', 'info');
    } catch (err) {
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
        await fetch(`${window.API_URL}/api/shopping-list/complete`, { method: 'POST', credentials: 'include' });
      } catch (e) { /* silent */ }
    } catch (err) {
      this.pinError.textContent = 'Network error.';
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
        this.ui.showToast(data.error || 'Payment failed', 'error');
      }
    } catch (err) {
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

class MockLiveFeedModule {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.initDOM();
    this.bindEvents();
  }
  initDOM() {
    // Debug panel remains hidden (no floating button anymore)
    this.debugPanel = document.getElementById('debug-panel');
    this.simBtnToggleDock = document.getElementById('sim-btn-toggle-dock');
    this.simItemsButtons = document.getElementById('sim-items-buttons');
    this.loadProducts();
  }
  async loadProducts() {
    if (!this.simItemsButtons) return;
    try {
      const res = await fetch(`${window.API_URL}/api/products/list`);
      const data = await res.json();
      if (data.success && data.products) {
        this.simItemsButtons.innerHTML = data.products.map(p => `
          <button class="sim-add-btn" data-rfid="${p.rfidTag || ''}">+ ${p.name}</button>
        `).join('');
      }
    } catch (err) { /* silent */ }
  }
  bindEvents() {
    if (this.simBtnToggleDock) {
      this.simBtnToggleDock.addEventListener('click', async () => {
        const cartId = this.cartModule.cartId;
        if (!cartId) return;
        const isCurrentlyDocked = this.cartModule.isDockedAtStation;
        const endpoint = isCurrentlyDocked ? 'station-undock' : 'station-dock';
        await fetch(`${window.API_URL}/api/hardware/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cart_id: cartId })
        });
        this.cartModule.setDockedState(!isCurrentlyDocked);
      });
    }
  }
}

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
      <a href="/history.html" class="btn-list-link" title="My Shopping History">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span class="list-link-text">History</span>
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
        await fetch(`${window.API_URL}/api/cart/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cart_id: window.cartModule.cartId })
        });
      }
      await fetch(`${window.API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      window.location.href = '/login.html';
    } catch (err) { console.error(err); }
  }
}

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

  const urlParams = new URLSearchParams(window.location.search);
  let urlCartId = urlParams.get('cart_id');

  if (urlCartId) {
    localStorage.setItem('pendingCartId', urlCartId);
  } else {
    const saved = localStorage.getItem('pendingCartId');
    if (saved) urlCartId = saved;
  }

  if (urlCartId) {
    setTimeout(() => {
      if (authModule.customer) {
        appBus.emit('qr:scanned', { cartId: urlCartId });
        localStorage.removeItem('pendingCartId');
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
      appBus.emit('ui:toast', { message: 'Pairing failed', type: 'error' });
    }
  });

  let lastServerSignature = '';
  let lastDockedState = false;

  function applyServerSession(session) {
    if (!session) {
      const receiptModal = document.getElementById('modal-receipt');
      const receiptVisible = receiptModal && !receiptModal.classList.contains('hidden');
      if (receiptVisible) return;
      if (cartModule.cartId) {
        cartModule.items = [];
        cartModule.removalRequests = [];
        cartModule.setDockedState(false);
        lastServerSignature = '';
        lastDockedState = false;
        cartModule.unpairCart();
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
  pollCart();
});