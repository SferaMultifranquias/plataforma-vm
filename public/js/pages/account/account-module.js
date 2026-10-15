(function initAccountModule(global) {
  function getUser() {
    return typeof global.getCurrentUser === 'function' ? global.getCurrentUser() : null;
  }

  function getSb() {
    return global.sb || null;
  }

  function showToast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function openMinhaConta() {
    var modal = document.getElementById('account-modal');
    if (modal) modal.classList.remove('hidden');

    var user = getUser();
    var emailField = document.getElementById('account-current-email');
    if (emailField) {
      emailField.value = (user && user.email) || '';
    }

    bindOnce('account-save-email-btn', handleSaveEmail);
    bindOnce('account-save-password-btn', handleSavePassword);
    bindOnce('account-close-btn', handleClose);
    // no footer close button
    bindOnceOverlay('account-overlay');
    bindOnceEscape();
  }

  function closeMinhaConta() {
    var modal = document.getElementById('account-modal');
    if (modal) modal.classList.add('hidden');

    clearField('account-email-password');
    clearField('account-new-email');
    clearField('account-password-current');
    clearField('account-password-new');
    clearField('account-password-confirm');
  }

  function clearField(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  }

  function bindOnce(id, handler) {
    var el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.addEventListener('click', handler);
      el.dataset.bound = 'true';
    }
  }

  function bindOnceOverlay(id) {
    var el = document.getElementById(id);
    if (el && !el.dataset.boundClose) {
      el.addEventListener('click', function onOverlayClick(e) {
        if (e.target === el) closeMinhaConta();
      });
      el.dataset.boundClose = 'true';
    }
  }

  function bindOnceEscape() {
    if (document.documentElement.dataset.accountEscapeBound) return;
    document.addEventListener('keydown', function onEscape(e) {
      if (e.key === 'Escape') {
        var modal = document.getElementById('account-modal');
        if (modal && !modal.classList.contains('hidden')) closeMinhaConta();
      }
    });
    document.documentElement.dataset.accountEscapeBound = 'true';
  }

  function handleClose() {
    closeMinhaConta();
  }

  async function handleSaveEmail() {
    var newEmailEl = document.getElementById('account-new-email');
    var passwordEl = document.getElementById('account-email-password');

    var newEmail = newEmailEl && newEmailEl.value ? newEmailEl.value.trim() : '';
    if (!newEmail) { showToast('Informe o novo e-mail.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { showToast('E-mail inválido.'); return; }

    var password = passwordEl && passwordEl.value ? passwordEl.value : '';
    if (!password) { showToast('Informe sua senha atual.'); return; }

    var user = getUser();
    if (!user || !user.email) { showToast('Usuário não encontrado.'); return; }

    var sb = getSb();
    if (!sb) { showToast('Conexão não disponível.'); return; }

    try {
      var signInResult = await sb.auth.signInWithPassword({ email: user.email, password: password });
      if (signInResult.error) { showToast('Senha atual incorreta.'); return; }
    } catch (_) { showToast('Erro ao verificar senha.'); return; }

    try {
      var updateResult = await sb.auth.updateUser({ email: newEmail });
      if (updateResult.error) { showToast(updateResult.error.message || 'Erro ao atualizar e-mail.'); return; }
      showToast('Confirme o novo e-mail na mensagem enviada.');
      if (newEmailEl) newEmailEl.value = '';
      if (passwordEl) passwordEl.value = '';
    } catch (_) { showToast('Erro ao atualizar e-mail.'); }
  }

  async function handleSavePassword() {
    var currentPassEl = document.getElementById('account-password-current');
    var newPassEl = document.getElementById('account-password-new');
    var confirmPassEl = document.getElementById('account-password-confirm');

    var currentPass = currentPassEl && currentPassEl.value ? currentPassEl.value : '';
    if (!currentPass) { showToast('Informe sua senha atual.'); return; }

    var newPass = newPassEl && newPassEl.value ? newPassEl.value : '';
    if (!newPass) { showToast('Informe a nova senha.'); return; }
    if (newPass.length < 8) { showToast('A nova senha deve ter ao menos 8 caracteres.'); return; }

    var confirmPass = confirmPassEl && confirmPassEl.value ? confirmPassEl.value : '';
    if (newPass !== confirmPass) { showToast('A confirmação da nova senha não corresponde.'); return; }

    var user = getUser();
    if (!user || !user.email) { showToast('Usuário não encontrado.'); return; }

    var sb = getSb();
    if (!sb) { showToast('Conexão não disponível.'); return; }

    try {
      var signInResult = await sb.auth.signInWithPassword({ email: user.email, password: currentPass });
      if (signInResult.error) { showToast('Senha atual incorreta.'); return; }
    } catch (_) { showToast('Erro ao verificar senha.'); return; }

    try {
      var updateResult = await sb.auth.updateUser({ password: newPass });
      if (updateResult.error) { showToast(updateResult.error.message || 'Erro ao atualizar senha.'); return; }
      showToast('Senha atualizada com sucesso.');
      if (currentPassEl) currentPassEl.value = '';
      if (newPassEl) newPassEl.value = '';
      if (confirmPassEl) confirmPassEl.value = '';
    } catch (_) { showToast('Erro ao atualizar senha.'); }
  }

  // auto-bind open trigger on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOpenTrigger);
  } else {
    bindOpenTrigger();
  }

  function bindOpenTrigger() {
    var btn = document.getElementById('account-open-btn');
    if (btn && !btn.dataset.bound) {
      btn.addEventListener('click', openMinhaConta);
      btn.dataset.bound = 'true';
    }
  }

  global.AccountModule = {
    openMinhaConta: openMinhaConta,
    closeMinhaConta: closeMinhaConta,
  };
})(window);
