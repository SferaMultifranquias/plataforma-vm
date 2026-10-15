;(function () {
  'use strict';

  var currentResolver = null;
  var processing = false;
  var previousFocus = null;

  function $(id) { return document.getElementById(id); }

  function trapFocus(e) {
    var modal = $('confirm-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    var focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function close() {
    var m = $('confirm-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
    var pwBlock = $('confirm-modal-password-block');
    if (pwBlock) {
      pwBlock.classList.add('hidden');
      var pwInput = $('confirm-modal-password-input');
      if (pwInput) pwInput.value = '';
    }
    currentResolver = null;
    processing = false;
    if (previousFocus) {
      try { previousFocus.focus(); } catch (_) {}
      previousFocus = null;
    }
  }

  function handleConfirm() {
    if (processing) return;
    var resolve = currentResolver;
    if (!resolve) return;
    processing = true;
    var confirmBtn = $('confirm-modal-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-busy', 'true');
    }
    var pwBlock = $('confirm-modal-password-block');
    if (pwBlock && !pwBlock.classList.contains('hidden')) {
      var pwInput = $('confirm-modal-password-input');
      var password = pwInput && pwInput.value ? pwInput.value.trim() : '';
      if (!password) {
        processing = false;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.removeAttribute('aria-busy');
        }
        if (pwInput) pwInput.focus();
        return;
      }
      close();
      resolve(password);
    } else {
      close();
      resolve(true);
    }
  }

  function handleCancel() {
    if (processing) return;
    var resolve = currentResolver;
    var pwBlock = $('confirm-modal-password-block');
    var isPassword = pwBlock && !pwBlock.classList.contains('hidden');
    close();
    if (resolve) resolve(isPassword ? null : false);
  }

  function confirm(title, description, options) {
    return new Promise(function (resolve) {
      var modal = $('confirm-modal');
      var titleEl = $('confirm-modal-title');
      var descEl = $('confirm-modal-desc');
      var confirmBtn = $('confirm-modal-confirm');
      var cancelBtn = $('confirm-modal-cancel');

      if (!modal || !titleEl || !descEl || !confirmBtn) {
        resolve(false);
        return;
      }

      var opt = options || {};
      previousFocus = document.activeElement;

      titleEl.textContent = title || 'Confirmar';
      descEl.textContent = description || '';

      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('aria-busy');
      confirmBtn.textContent = opt.confirmText || 'Confirmar';
      if (opt.confirmClass) {
        confirmBtn.className = 'px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 ' + opt.confirmClass;
      } else {
        confirmBtn.className = 'px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500';
      }

      cancelBtn.textContent = opt.cancelText || 'Cancelar';

      currentResolver = resolve;
      processing = false;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      confirmBtn.focus();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); return; }
    if (e.key === 'Enter') {
      var confirmBtn = $('confirm-modal-confirm');
      if (confirmBtn && !confirmBtn.disabled && !confirmBtn.hasAttribute('aria-busy')) {
        var modal = $('confirm-modal');
        if (modal && !modal.classList.contains('hidden')) {
          e.preventDefault();
          handleConfirm();
          return;
        }
      }
    }
    trapFocus(e);
  });

  document.addEventListener('click', function (e) {
    var modal = $('confirm-modal');
    if (modal && e.target === modal) { handleCancel(); return; }
    if (e.target.id === 'confirm-modal-cancel') { handleCancel(); return; }
    if (e.target.id === 'confirm-modal-confirm') { handleConfirm(); }
  });

  function confirmPassword(title, description, options) {
    return new Promise(function (resolve) {
      var modal = $('confirm-modal');
      var titleEl = $('confirm-modal-title');
      var descEl = $('confirm-modal-desc');
      var confirmBtn = $('confirm-modal-confirm');
      var cancelBtn = $('confirm-modal-cancel');
      var pwBlock = $('confirm-modal-password-block');
      var pwInput = $('confirm-modal-password-input');

      if (!modal || !titleEl || !descEl || !confirmBtn || !pwBlock || !pwInput) {
        resolve(null);
        return;
      }

      var opt = options || {};
      previousFocus = document.activeElement;

      titleEl.textContent = title || 'Confirmar';
      descEl.textContent = description || '';

      pwBlock.classList.remove('hidden');
      pwInput.value = '';
      pwInput.removeAttribute('disabled');

      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('aria-busy');
      confirmBtn.textContent = opt.confirmText || 'Excluir Permanentemente';
      if (opt.confirmClass) {
        confirmBtn.className = 'px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 ' + opt.confirmClass;
      } else {
        confirmBtn.className = 'px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500';
      }

      cancelBtn.textContent = opt.cancelText || 'Cancelar';

      currentResolver = resolve;
      processing = false;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');

      setTimeout(function () { pwInput && pwInput.focus(); }, 50);
    });
  }

  window.ConfirmModal = { confirm: confirm, confirmPassword: confirmPassword };
})();
