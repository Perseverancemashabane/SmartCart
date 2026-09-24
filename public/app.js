/**
 * SmartCart IoT - Modular Single Page Application Logic
 * Architecture: EventBus Pub/Sub Pattern with State Modules & UI Controllers
 */

// ==========================================================================
// 1. Pub/Sub Event Bus Module
// ==========================================================================
class EventBus {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  off(event, listenerToRemove) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
  }

  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(data));
  }
}

// Global Application Event Bus Instance
const appBus = new EventBus();


// ==========================================================================
// 2. Cart State Management Module
// ==========================================================================
class CartStateModule {
  constructor(bus) {
    this.bus = bus;
    this.cartId = null;
    this.items = []; // Array of { id, sku, name, price, quantity, icon }
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid'; // 'unpaid' | 'processing' | 'paid'
    this.vatRate = 0.15; // 15% South African VAT
  }

  pairCart(id) {
    this.cartId = id;
    this.items = [];
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid';
    this.bus.emit('cart:paired', { cartId: this.cartId });
  }

  unpairCart() {
    const prevId = this.cartId;
    this.cartId = null;
    this.items = [];
    this.isDockedAtStation = false;
    this.paymentStatus = 'unpaid';
    this.bus.emit('cart:unpaired', { cartId: prevId });
  }

  addItem(itemData) {
    // Check if item already exists by SKU
    const existing = this.items.find(i => i.sku === itemData.sku);
    let affectedItem;

    if (existing) {
      existing.quantity += 1;
      affectedItem = existing;
    } else {
      affectedItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        sku: itemData.sku,
        name: itemData.name,
        price: parseFloat(itemData.price),
        quantity: 1,
        icon: itemData.icon || 'fa-box'
      };
      this.items.push(affectedItem);
    }

    this.bus.emit('cart:updated', this.getStateSummary());
    this.bus.emit('cart:item_added', { item: affectedItem, totalItems: this.items.length });
    return affectedItem;
  }

  removeItem(sku) {
    const index = this.items.findIndex(i => i.sku === sku);
    if (index === -1) return null;

    const targetItem = this.items[index];
    if (targetItem.quantity > 1) {
      targetItem.quantity -= 1;
      this.bus.emit('cart:updated', this.getStateSummary());
      this.bus.emit('cart:item_removed', { item: targetItem, removedCompletely: false });
    } else {
      this.items.splice(index, 1);
      this.bus.emit('cart:updated', this.getStateSummary());
      this.bus.emit('cart:item_removed', { item: targetItem, removedCompletely: true });
    }
  }

  removeLastItem() {
    if (this.items.length === 0) return;
    const lastItem = this.items[this.items.length - 1];
    this.removeItem(lastItem.sku);
  }

  clearCart() {
    this.items = [];
    this.bus.emit('cart:updated', this.getStateSummary());
  }

  setDockedState(isDocked) {
    this.isDockedAtStation = Boolean(isDocked);
    this.bus.emit('station:changed', { isDocked: this.isDockedAtStation });
  }

  toggleDockedState() {
    this.setDockedState(!this.isDockedAtStation);
  }

  // Financial Calculations
  getSubtotal() {
    return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  getVatAmount() {
    return this.getSubtotal() * this.vatRate;
  }

  getTotalAmount() {
    return this.getSubtotal() + this.getVatAmount();
  }

  getItemCount() {
    return this.items.reduce((count, item) => count + item.quantity, 0);
  }

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

  // ZAR Currency Formatter Helper (R 150.00)
  static formatCurrency(amount) {
    const num = parseFloat(amount || 0);
    return 'R ' + num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  }
}


// ==========================================================================
// 3. QR Code Scanner Module (html5-qrcode integration)
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

    // Bind event listeners
    if (this.btnStartQr) {
      this.btnStartQr.addEventListener('click', () => this.openScannerModal());
    }

    if (this.btnCloseQr) {
      this.btnCloseQr.addEventListener('click', () => this.closeScannerModal());
    }

    if (this.btnPairManual) {
      this.btnPairManual.addEventListener('click', () => this.handleManualPairing());
    }

    // Quick preset buttons
    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cartId = e.target.getAttribute('data-cart');
        if (this.inputCartId) this.inputCartId.value = cartId;
        this.triggerPairing(cartId);
      });
    });
  }

  openScannerModal() {
    if (!this.qrModal) return;
    this.qrModal.classList.remove('hidden');

    // Initialize html5-qrcode
    try {
      if (typeof Html5Qrcode !== 'undefined') {
        this.html5QrcodeScanner = new Html5Qrcode("qr-reader");
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };

        this.html5QrcodeScanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => this.onScanSuccess(decodedText),
          () => {} // Silent scan error
        ).catch(err => {
          console.warn("Camera access failed or unavailable:", err);
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
          <p style="font-size: 0.78rem; margin-top: 6px;">Please use manual Cart ID entry or quick test chips.</p>
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
    if (this.qrModal) {
      this.qrModal.classList.add('hidden');
    }
  }

  onScanSuccess(decodedText) {
    this.closeScannerModal();
    // Parse QR payload (extract cart_id if formatted like cart_id=CART_004)
    let cartId = decodedText.trim();
    if (cartId.includes('cart_id=')) {
      cartId = cartId.split('cart_id=')[1].split('&')[0];
    }
    this.triggerPairing(cartId || 'CART_001');
  }

  handleManualPairing() {
    const val = this.inputCartId ? this.inputCartId.value.trim() : '';
    if (!val) {
      appBus.emit('ui:toast', { message: 'Please enter a valid Cart ID', type: 'warning' });
      return;
    }
    this.triggerPairing(val.toUpperCase());
  }

  triggerPairing(cartId) {
    this.bus.emit('qr:scanned', { cartId });
  }
}


// ==========================================================================
// 4. UI Controller & View Manager Module
// ==========================================================================
class UIController {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    // Views
    this.viewPairing = document.getElementById('view-pairing');
    this.viewCart = document.getElementById('view-cart');
    this.modalPayment = document.getElementById('modal-payment');
    this.modalReceipt = document.getElementById('modal-receipt');

    // Header & Info
    this.pairedCartIdDisplay = document.getElementById('paired-cart-id-display');
    this.btnDisconnect = document.getElementById('btn-disconnect');
    this.itemCountBadge = document.getElementById('cart-item-count-badge');

    // Containers
    this.emptyCartState = document.getElementById('empty-cart-state');
    this.cartItemsContainer = document.getElementById('cart-items-container');

    // Price summary
    this.summarySubtotal = document.getElementById('summary-subtotal');
    this.summaryVat = document.getElementById('summary-vat');
    this.summaryTotal = document.getElementById('summary-total');

    // Station Banner & Checkout Button
    this.stationStatusBanner = document.getElementById('station-status-banner');
    this.stationIcon = document.getElementById('station-icon');
    this.stationStatusText = document.getElementById('station-status-text');
    this.stationBadge = document.getElementById('station-badge');
    
    this.btnCheckout = document.getElementById('btn-checkout');
    this.checkoutBtnIcon = document.getElementById('checkout-btn-icon');
    this.checkoutBtnText = document.getElementById('checkout-btn-text');
    this.checkoutTooltip = document.getElementById('checkout-tooltip');

    // Toast Container
    this.toastContainer = document.getElementById('toast-container');
  }

  bindEvents() {
    // Cart Pairing Events
    this.bus.on('cart:paired', (data) => {
      if (this.pairedCartIdDisplay) this.pairedCartIdDisplay.textContent = `Cart #${data.cartId.replace('CART_', '')}`;
      this.switchView('view-cart');
      this.showToast(`Successfully paired with ${data.cartId}`, 'success');
    });

    this.bus.on('cart:unpaired', () => {
      this.switchView('view-pairing');
      this.showToast('Cart unpaired successfully', 'info');
    });

    if (this.btnDisconnect) {
      this.btnDisconnect.addEventListener('click', () => {
        this.cartModule.unpairCart();
      });
    }

    // State Updates
    this.bus.on('cart:updated', (state) => this.renderCartState(state));

    this.bus.on('cart:item_added', (data) => {
      this.showToast(`RFID Scanned: + ${data.item.name}`, 'success');
      this.highlightItemCard(data.item.sku, 'flash-add');
    });

    this.bus.on('cart:item_removed', (data) => {
      this.showToast(`Item Removed: ${data.item.name}`, 'info');
      this.highlightItemCard(data.item.sku, 'flash-remove');
    });

    this.bus.on('station:changed', (data) => {
      this.renderStationBanner(data.isDocked);
    });

    // Checkout Button Click
    if (this.btnCheckout) {
      this.btnCheckout.addEventListener('click', () => {
        if (!this.cartModule.isDockedAtStation) {
          this.showToast('Return cart to base station to unlock payment!', 'warning');
          return;
        }
        if (this.cartModule.items.length === 0) {
          this.showToast('Your cart is empty! Add items before checkout.', 'warning');
          return;
        }
        this.bus.emit('checkout:opened');
      });
    }

    // Generic Toast listener
    this.bus.on('ui:toast', (data) => this.showToast(data.message, data.type));
  }

  switchView(targetViewId) {
    [this.viewPairing, this.viewCart].forEach(view => {
      if (view) {
        if (view.id === targetViewId) {
          view.classList.remove('hidden');
          view.classList.add('view-active');
        } else {
          view.classList.add('hidden');
          view.classList.remove('view-active');
        }
      }
    });
  }

  renderCartState(state) {
    // Update Item Count Pill
    if (this.itemCountBadge) {
      this.itemCountBadge.textContent = `${state.itemCount} ${state.itemCount === 1 ? 'item' : 'items'}`;
    }

    // Toggle Empty State vs Items List
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

    // Render Price Summaries
    if (this.summarySubtotal) this.summarySubtotal.textContent = CartStateModule.formatCurrency(state.subtotal);
    if (this.summaryVat) this.summaryVat.textContent = CartStateModule.formatCurrency(state.vatAmount);
    if (this.summaryTotal) this.summaryTotal.textContent = CartStateModule.formatCurrency(state.totalAmount);

    // Update Checkout Button Locked / Unlocked State
    this.updateCheckoutButtonState(state.isDocked, state.items.length > 0);
  }

  renderItemsList(items) {
    if (!this.cartItemsContainer) return;
    
    // Build DOM list
    this.cartItemsContainer.innerHTML = items.map(item => {
      const subtotal = item.price * item.quantity;
      return `
        <div class="cart-item-card" id="card-${item.sku}">
          <div class="item-left">
            <div class="item-icon-box">
              <i class="fa-solid ${item.icon || 'fa-box'}"></i>
            </div>
            <div class="item-details">
              <h4>${item.name}</h4>
              <div class="item-meta">
                <span>SKU:</span>
                <span class="rfid-tag">${item.sku}</span>
              </div>
            </div>
          </div>
          
          <div class="item-right">
            <div class="quantity-controls">
              <button class="btn-qty btn-minus" data-sku="${item.sku}" title="Decrease quantity"><i class="fa-solid fa-minus"></i></button>
              <span class="qty-val">${item.quantity}</span>
              <button class="btn-qty btn-plus" data-sku="${item.sku}" title="Increase quantity"><i class="fa-solid fa-plus"></i></button>
            </div>
            
            <div class="item-pricing">
              <span class="item-subtotal-val">${CartStateModule.formatCurrency(subtotal)}</span>
              <span class="item-unit-price">${CartStateModule.formatCurrency(item.price)} ea</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind item quantity button clicks
    this.cartItemsContainer.querySelectorAll('.btn-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sku = e.currentTarget.getAttribute('data-sku');
        this.cartModule.removeItem(sku);
      });
    });

    this.cartItemsContainer.querySelectorAll('.btn-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sku = e.currentTarget.getAttribute('data-sku');
        const item = this.cartModule.items.find(i => i.sku === sku);
        if (item) this.cartModule.addItem(item);
      });
    });
  }

  highlightItemCard(sku, animationClass) {
    const card = document.getElementById(`card-${sku}`);
    if (card) {
      card.classList.remove('flash-add', 'flash-remove');
      // Trigger reflow
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
      this.showToast('Station Detected: Cart Docked at Checkout Bay', 'success');
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

    if (isDocked && hasItems) {
      this.btnCheckout.disabled = false;
      this.btnCheckout.className = 'btn btn-primary btn-block btn-lg btn-glow';
      if (this.checkoutBtnIcon) this.checkoutBtnIcon.className = 'fa-solid fa-credit-card';
      if (this.checkoutBtnText) this.checkoutBtnText.textContent = 'Proceed to Stripe Checkout';
      if (this.checkoutTooltip) this.checkoutTooltip.classList.add('hidden');
    } else {
      this.btnCheckout.disabled = true;
      this.btnCheckout.className = 'btn btn-primary btn-block btn-lg btn-locked';
      if (this.checkoutBtnIcon) this.checkoutBtnIcon.className = 'fa-solid fa-lock';
      if (this.checkoutBtnText) this.checkoutBtnText.textContent = hasItems ? 'Return Cart to Base Station to Pay' : 'Cart is Empty';
      if (this.checkoutTooltip) {
        this.checkoutTooltip.classList.remove('hidden');
        this.checkoutTooltip.innerHTML = hasItems 
          ? '<i class="fa-solid fa-triangle-exclamation"></i> Return cart to the base station to enable payment.'
          : '<i class="fa-solid fa-info-circle"></i> Add items using RFID scanner to proceed.';
      }
    }
  }

  showToast(message, type = 'info') {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';
    if (type === 'error') iconClass = 'fa-circle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${iconClass}"></i>
      <span>${message}</span>
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}


// ==========================================================================
// 5. Stripe Payment & Digital Receipt Integration Module
// ==========================================================================
class StripePaymentModule {
  constructor(bus, cartModule, uiController) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.ui = uiController;
    
    this.stripe = null;
    this.cardElement = null;

    this.initDOM();
    this.bindEvents();
    this.initStripe();
  }

  initDOM() {
    this.modalPayment = document.getElementById('modal-payment');
    this.btnClosePayment = document.getElementById('btn-close-payment');
    this.paymentTotalDisplay = document.getElementById('payment-total-display');
    this.paymentForm = document.getElementById('payment-form');
    this.cardErrors = document.getElementById('card-errors');
    
    this.btnPayNow = document.getElementById('btn-pay-now');
    this.payBtnSpinner = document.getElementById('pay-btn-spinner');
    this.payBtnText = document.getElementById('pay-btn-text');
    this.payBtnTotalVal = document.getElementById('pay-btn-total-val');

    // Receipt Modal
    this.modalReceipt = document.getElementById('modal-receipt');
    this.receiptOrderRef = document.getElementById('receipt-order-ref');
    this.receiptTimestamp = document.getElementById('receipt-timestamp');
    this.receiptItemsList = document.getElementById('receipt-items-list');
    this.receiptSubtotal = document.getElementById('receipt-subtotal');
    this.receiptVat = document.getElementById('receipt-vat');
    this.receiptTotal = document.getElementById('receipt-total');
    this.btnFinishReset = document.getElementById('btn-finish-reset');
  }

  initStripe() {
    try {
      // Use test key
      if (typeof Stripe !== 'undefined') {
        this.stripe = Stripe('pk_test_TYooMQbfWZsq259Y2yJuTLnY00w127vq0');
        const elements = this.stripe.elements();
        
        const style = {
          base: {
            color: '#f8fafc',
            fontFamily: 'Inter, sans-serif',
            fontSmoothing: 'antialiased',
            fontSize: '16px',
            '::placeholder': { color: '#64748b' }
          },
          invalid: {
            color: '#ef4444',
            iconColor: '#ef4444'
          }
        };

        const cardContainer = document.getElementById('card-element');
        if (cardContainer) {
          this.cardElement = elements.create('card', { style });
          this.cardElement.mount('#card-element');
          this.cardElement.on('change', (event) => {
            if (this.cardErrors) {
              this.cardErrors.textContent = event.error ? event.error.message : '';
            }
          });
        }
      } else {
        this.renderFallbackCardInput();
      }
    } catch (e) {
      console.warn('Stripe initialization fallback mode active:', e);
      this.renderFallbackCardInput();
    }
  }

  renderFallbackCardInput() {
    const cardContainer = document.getElementById('card-element');
    if (cardContainer) {
      cardContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <input type="text" placeholder="4242 •••• •••• 4242" value="4242 4242 4242 4242" style="width: 100%; background: transparent; border: none; color: #f8fafc; font-family: monospace; font-size: 1rem; outline: none;">
          <div style="display: flex; gap: 12px; font-size: 0.85rem; color: #94a3b8;">
            <span>MM/YY: 12/28</span>
            <span>CVC: 123</span>
          </div>
        </div>
      `;
    }
  }

  bindEvents() {
    this.bus.on('checkout:opened', () => this.openPaymentModal());

    if (this.btnClosePayment) {
      this.btnClosePayment.addEventListener('click', () => this.closePaymentModal());
    }

    if (this.paymentForm) {
      this.paymentForm.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    if (this.btnFinishReset) {
      this.btnFinishReset.addEventListener('click', () => this.resetAndFinish());
    }
  }

  openPaymentModal() {
    const totalFormatted = CartStateModule.formatCurrency(this.cartModule.getTotalAmount());
    if (this.paymentTotalDisplay) this.paymentTotalDisplay.textContent = totalFormatted;
    if (this.payBtnTotalVal) this.payBtnTotalVal.textContent = totalFormatted;
    if (this.cardErrors) this.cardErrors.textContent = '';
    
    if (this.modalPayment) this.modalPayment.classList.remove('hidden');
  }

  closePaymentModal() {
    if (this.modalPayment) this.modalPayment.classList.add('hidden');
  }

  async handlePaymentSubmit(e) {
    e.preventDefault();

    // Show loading state
    this.setPaymentLoading(true);

    // Simulate Payment Authorization delay
    await new Promise(resolve => setTimeout(resolve, 1600));

    this.setPaymentLoading(false);
    this.closePaymentModal();
    
    // Show digital receipt
    this.generateReceipt();
  }

  setPaymentLoading(isLoading) {
    if (this.btnPayNow) this.btnPayNow.disabled = isLoading;
    if (this.payBtnSpinner) {
      if (isLoading) this.payBtnSpinner.classList.remove('hidden');
      else this.payBtnSpinner.classList.add('hidden');
    }
  }

  generateReceipt() {
    const summary = this.cartModule.getStateSummary();
    const orderNum = 'ORD-' + Math.floor(1000 + Math.random() * 9000) + '-ZAR';
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);

    if (this.receiptOrderRef) this.receiptOrderRef.textContent = `REF: #${orderNum}`;
    if (this.receiptTimestamp) this.receiptTimestamp.textContent = now;

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

    if (this.modalReceipt) this.modalReceipt.classList.remove('hidden');
    this.ui.showToast('Payment Authorized & Cleared!', 'success');
  }

  async resetAndFinish() {
    if (this.modalReceipt) this.modalReceipt.classList.add('hidden');

    const cartId = this.cartModule.cartId;
    console.log(`[Reset] Starting reset for ${cartId}`);

    if (cartId) {
      try {
        const isLocalhost = window.location.hostname === 'localhost';
        const API_URL = isLocalhost 
          ? 'http://localhost:3000' 
          : 'https://smart-cart-5qod.vercel.app';

        // Call the reset endpoint
        const response = await fetch(`${API_URL}/api/cart/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart_id: cartId })
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Reset] Server response:', data);
        } else {
          console.warn('[Reset] Server error:', response.status);
        }
      } catch (err) {
        console.warn('[Reset] Network error:', err);
      }
    }

    // NOW unpair locally — after server reset completes
    this.cartModule.unpairCart();
  }
}


// ==========================================================================
// 6. Mock Live Feed & ESP32 Simulation Panel Module (Hidden by Default)
// ==========================================================================
class MockLiveFeedModule {
  constructor(bus, cartModule) {
    this.bus = bus;
    this.cartModule = cartModule;
    this.isExpanded = false;

    this.initDOM();
    this.bindEvents();
    this.setupKeyboardToggle();
  }

  initDOM() {
    this.debugPanel = document.getElementById('debug-panel');
    this.debugHandle = document.getElementById('debug-handle');
    this.btnToggleDebug = document.getElementById('btn-toggle-debug');
    this.debugToggleText = document.getElementById('debug-toggle-text');
    this.debugChevron = document.getElementById('debug-chevron');
    
    this.simBtnToggleDock = document.getElementById('sim-btn-toggle-dock');
    this.simDockText = document.getElementById('sim-dock-text');
    this.debugEventLog = document.getElementById('debug-event-log');

    // Presets
    this.simPresetQuick = document.getElementById('sim-preset-quick');
    this.simPresetTrolley = document.getElementById('sim-preset-trolley');
    this.simRemoveRandom = document.getElementById('sim-remove-random');
    this.simClearAll = document.getElementById('sim-clear-all');

    // Hide the debug panel by default
    if (this.debugPanel) {
      this.debugPanel.style.display = 'none';
    }
  }

  setupKeyboardToggle() {
    // Ctrl + Shift + D toggles the debug panel
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.toggleDebugPanelVisibility();
      }
    });
  }

  toggleDebugPanelVisibility() {
    if (!this.debugPanel) return;
    const isHidden = this.debugPanel.style.display === 'none';
    this.debugPanel.style.display = isHidden ? 'block' : 'none';
    console.log(`Debug panel ${isHidden ? 'shown' : 'hidden'}`);
  }

  bindEvents() {
    // Drawer Expand/Collapse
    if (this.debugHandle) {
      this.debugHandle.addEventListener('click', () => this.togglePanel());
    }

    // Add item buttons
    document.querySelectorAll('.sim-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sku = e.currentTarget.getAttribute('data-sku');
        const name = e.currentTarget.getAttribute('data-name');
        const price = parseFloat(e.currentTarget.getAttribute('data-price'));
        
        this.cartModule.addItem({ sku, name, price });
        this.logMQTTEvent('rfid_scan', { action: 'ADD_ITEM', sku, name, price });
      });
    });

    // Base Station Proximity Toggle
    if (this.simBtnToggleDock) {
      this.simBtnToggleDock.addEventListener('click', () => {
        this.cartModule.toggleDockedState();
        const isDocked = this.cartModule.isDockedAtStation;
        
        if (this.simDockText) {
          this.simDockText.textContent = isDocked 
            ? 'Undock Cart (Set to In Aisle 🛒)' 
            : 'Simulate Station Docking (Unlock Pay ⚡)';
        }

        this.logMQTTEvent('station_gateway', { event: 'DOCK_STATUS', station_docked: isDocked });
      });
    }

    // Presets
    if (this.simPresetQuick) {
      this.simPresetQuick.addEventListener('click', () => {
        this.cartModule.addItem({ sku: 'MILK-001', name: 'Organic Fresh Milk 2L', price: 32.50 });
        this.cartModule.addItem({ sku: 'BREAD-002', name: 'Artisan Sourdough Bread', price: 24.00 });
        this.logMQTTEvent('preset_trigger', { preset: 'QUICK_GROCERY', items_added: 2 });
      });
    }

    if (this.simPresetTrolley) {
      this.simPresetTrolley.addEventListener('click', () => {
        this.cartModule.addItem({ sku: 'STEAK-004', name: 'A-Grade Ribeye Steak 500g', price: 185.00 });
        this.cartModule.addItem({ sku: 'APPLE-003', name: 'Crisp Red Apples 1kg', price: 45.00 });
        this.cartModule.addItem({ sku: 'COFFEE-006', name: 'Espresso Coffee Beans 500g', price: 120.00 });
        this.cartModule.addItem({ sku: 'WATER-005', name: 'Still Mineral Water 6-Pack', price: 55.00 });
        this.logMQTTEvent('preset_trigger', { preset: 'FULL_TROLLEY', items_added: 4 });
      });
    }

    if (this.simRemoveRandom) {
      this.simRemoveRandom.addEventListener('click', () => {
        this.cartModule.removeLastItem();
        this.logMQTTEvent('rfid_scan', { action: 'REMOVE_LAST_ITEM' });
      });
    }

    if (this.simClearAll) {
      this.simClearAll.addEventListener('click', () => {
        this.cartModule.clearCart();
        this.logMQTTEvent('rfid_scan', { action: 'CLEAR_ALL' });
      });
    }
  }

  togglePanel() {
    if (!this.debugPanel) return;
    this.isExpanded = !this.isExpanded;

    if (this.isExpanded) {
      this.debugPanel.classList.remove('collapsed');
      if (this.debugToggleText) this.debugToggleText.textContent = 'Collapse Controls';
      if (this.debugChevron) this.debugChevron.className = 'fa-solid fa-chevron-down';
    } else {
      this.debugPanel.classList.add('collapsed');
      if (this.debugToggleText) this.debugToggleText.textContent = 'Expand Controls';
      if (this.debugChevron) this.debugChevron.className = 'fa-solid fa-chevron-up';
    }
  }

  logMQTTEvent(topic, payload) {
    if (!this.debugEventLog) return;

    const time = new Date().toLocaleTimeString();
    const logLine = document.createElement('div');
    
    let typeClass = 'info';
    if (payload.action === 'ADD_ITEM') typeClass = 'add';
    if (payload.action === 'REMOVE_LAST_ITEM' || payload.action === 'CLEAR_ALL') typeClass = 'remove';
    if (topic === 'station_gateway') typeClass = 'station';

    logLine.className = `log-line ${typeClass}`;
    logLine.textContent = `[${time}] [mqtt/${topic}] ${JSON.stringify(payload)}`;

    this.debugEventLog.appendChild(logLine);
    this.debugEventLog.scrollTop = this.debugEventLog.scrollHeight;
  }
}


// ==========================================================================
// 7. Application Initialization Entry Point
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  const cartModule = new CartStateModule(appBus);
  const qrScanner = new QRScannerModule(appBus);
  const uiController = new UIController(appBus, cartModule);
  const stripePayment = new StripePaymentModule(appBus, cartModule, uiController);
  const mockFeed = new MockLiveFeedModule(appBus, cartModule);

  appBus.on('qr:scanned', (data) => {
    cartModule.pairCart(data.cartId);
  });

      // ============================================================
  // REAL-TIME CART SYNC — SSE with polling fallback
  // Tries SSE for instant updates, falls back to 2s polling
  // if the SSE connection fails or drops.
  // ============================================================
  const isLocalhost = window.location.hostname === 'localhost';
  const API_URL = isLocalhost 
    ? 'http://localhost:3000' 
    : 'https://smart-cart-5qod.vercel.app';

  let sseConnection = null;
  let sseWorking = false;
  let lastServerSignature = '';

  // ---------- Apply server session to local cart ----------
  function applyServerSession(session) {
    if (!session) return;

    // Sync docked state
    if (session.isDocked !== cartModule.isDockedAtStation) {
      cartModule.setDockedState(session.isDocked);
    }

    // Build server items list
    const rawItems = session.items || [];
    const serverItems = rawItems.map(item => ({
      sku: item.sku,
      name: item.name,
      price: item.unitPriceCents ? (item.unitPriceCents / 100) : parseFloat(item.price || 0),
      quantity: item.quantity,
      icon: 'fa-box'
    }));

    const serverSignature = JSON.stringify(serverItems.map(i => 
      `${i.sku}|${i.name}|${i.price}|${i.quantity}`
    ));

    if (serverSignature !== lastServerSignature) {
      lastServerSignature = serverSignature;
      cartModule.items = serverItems;
      appBus.emit('cart:updated', cartModule.getStateSummary());
      console.log(`[Sync] Cart updated: ${serverItems.length} item(s)`);
    }
  }

  // ---------- Polling fallback ----------
  async function pollCart() {
    if (!cartModule.cartId) {
      setTimeout(pollCart, 2000);
      return;
    }

    // Skip polling if SSE is confirmed working
    if (sseWorking) {
      setTimeout(pollCart, 2000);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/cart/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cartModule.cartId })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.session) {
          applyServerSession(data.session);
        }
      }
    } catch (err) {
      console.warn('[Poll] Error:', err);
    }

    setTimeout(pollCart, 2000);
  }

  // ---------- SSE connection ----------
  function connectSSE(cartId) {
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
    }

    console.log(`[SSE] Connecting to stream for ${cartId}...`);

    try {
      sseConnection = new EventSource(`${API_URL}/api/cart/stream/${cartId}`);

      sseConnection.onopen = () => {
        sseWorking = true;
        console.log(`[SSE] Connected to ${cartId} stream`);
      };

      sseConnection.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          console.log('[SSE] Message:', payload);

          if (payload.event === 'connected') {
            sseWorking = true;
            return;
          }

          if (payload.event === 'cart_updated' || payload.event === 'station_docked') {
            applyServerSession(payload);
          }

          if (payload.event === 'payment_succeeded') {
            cartModule.setDockedState(false);
          }
        } catch (err) {
          console.warn('[SSE] Failed to parse event:', err);
        }
      };

      sseConnection.onerror = (err) => {
        console.warn('[SSE] Connection error — falling back to polling');
        sseWorking = false;
        if (sseConnection) {
          sseConnection.close();
          sseConnection = null;
        }
      };
    } catch (err) {
      console.warn('[SSE] Exception:', err);
      sseWorking = false;
    }
  }

  // ---------- Wire up to cart pairing ----------
  appBus.on('cart:paired', (data) => {
    connectSSE(data.cartId);
  });

  appBus.on('cart:unpaired', () => {
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
    }
    sseWorking = false;
    lastServerSignature = '';
  });

  // ---------- Start polling as a fallback (always runs) ----------
  pollCart();

  console.log('SmartCart IoT Application Engine Started Successfully.');
  console.log('Sync mode: SSE with polling fallback. API:', API_URL);
  console.log('Press Ctrl+Shift+D to toggle the ESP32 simulator panel.');
});