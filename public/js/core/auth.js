(function initAuthModule(global) {
  var backendHeartbeatId = null;
  var bootstrapPromise = null;
  var authSyncPromise = Promise.resolve();
  var authBootstrapping = false;
  var lastBootstrapDeps = null;
  var bootstrapState = {
    current: 'IDLE',
    details: null,
  };

  function getDiagnostics() {
    return global.AppDiagnostics || {};
  }

  function logBoot(stage, phase, details) {
    if (typeof getDiagnostics().logBootstrapEvent === 'function') {
      getDiagnostics().logBootstrapEvent(stage, phase, details);
    }
  }

  function logAuth(event, details) {
    if (typeof getDiagnostics().logAuthEvent === 'function') {
      getDiagnostics().logAuthEvent(event, details);
    }
  }

  function withTimeout(label, promise, timeoutMs) {
    if (typeof getDiagnostics().withTimeout === 'function') {
      return getDiagnostics().withTimeout(label, promise, timeoutMs);
    }

    var timeoutId;
    var timeout = new Promise(function timeoutPromise(_, reject) {
      timeoutId = setTimeout(function onTimeout() {
        reject(new Error(label + ' timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(function clearTimeoutId() {
      clearTimeout(timeoutId);
    });
  }

  function setBootstrapState(nextState, details) {
    bootstrapState.current = nextState;
    bootstrapState.details = details || null;

    var message = document.getElementById('bootstrap-message');
    if (message) {
      var labels = {
        IDLE: 'Restaurando sessao...',
        LOADING_CONFIG: 'Carregando configuracao...',
        CREATING_CLIENT: 'Conectando ao Supabase...',
        RESTORING_SESSION: 'Restaurando sessao...',
        VALIDATING_USER: 'Validando usuario...',
        LOADING_PROFILE: 'Carregando perfil...',
        BUILDING_PERMISSIONS: 'Aplicando permissões...',
        STARTING_ROUTER: 'Abrindo a interface...',
        READY_PUBLIC: 'Login pronto.',
        READY_AUTHENTICATED: 'Aplicacao pronta.',
        ERROR: 'Falha ao iniciar.',
      };
      message.textContent = labels[nextState] || labels.IDLE;
    }
  }

  function isAuthSessionError(error) {
    var status = error && (error.status || error.statusCode);
    var message = String(error && error.message || error || '').toLowerCase();
    return status === 401 || status === 403 || message.includes('jwt') || message.includes('auth session missing') || message.includes('token expired') || message.includes('refresh token') || message.includes('invalid token') || message.includes('unauthorized');
  }

  function getSb(deps) {
    return typeof deps.getSb === 'function' ? deps.getSb() : deps.sb;
  }

  async function ensureSb(deps) {
    var sb = getSb(deps);
    if (sb) return sb;

    if (typeof deps.initSupabase === 'function') {
      await deps.initSupabase();
      sb = getSb(deps);
    }

    if (!sb) {
      throw new Error('Conexao com o Supabase nao inicializada.');
    }

    return sb;
  }

  function toggleSenhaVisivel(inputId, button) {
    var input = document.getElementById(inputId);
    if (!input) return;

    var visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';

    if (button) {
      button.innerHTML = '<i data-lucide="' + (visible ? 'eye' : 'eye-off') + '" class="w-4 h-4"></i>';
    }

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  // Lojas fora do VM (Levi's, Hering, Venda Direta) acessam só o módulo Suprimentos.
  // Em caso de falha, mantém o comportamento antigo (acesso ao VM).
  async function carregarAcessoVm(sb, papel) {
    if (papel === 'admin' || !sb || typeof sb.rpc !== 'function') return true;
    try {
      var result = await withTimeout('vm access', sb.rpc('current_user_uses_vm'), 8000);
      if (result && !result.error && result.data === false) return false;
    } catch (error) {
      console.warn('Falha ao verificar acesso ao VM:', error && error.message ? error.message : error);
    }
    return true;
  }

  async function carregarUsuarioAtual(deps) {
    var sb = await ensureSb(deps);
    logBoot('user', 'start');

    var authResult;
    try {
      authResult = await withTimeout('getUser', sb.auth.getUser(), 8000);
    } catch (error) {
      logBoot('user', 'error', { message: error && error.message ? error.message : 'getUser failed' });
      throw error;
    }

    if (authResult.error) {
      logBoot('user', 'error', { message: authResult.error.message || 'getUser error' });
      throw authResult.error;
    }

    var authUser = authResult.data?.user;
    if (!authUser) {
      logBoot('user', 'complete', { status: 'empty' });
      return null;
    }

    logBoot('user', 'complete');

    var profile = null;
    var profileError = null;

    logBoot('profile', 'start');
    try {
      var result = await withTimeout(
        'profile query',
        sb
          .from('profiles')
          .select('id,name,email,role,is_active')
          .eq('id', authUser.id)
          .maybeSingle(),
        10000
      );
      profile = result.data;
      profileError = result.error;
    } catch (error) {
      profileError = error;
    }

    var missingProfilesTable = String(profileError?.message || '').includes("Could not find the table 'public.profiles'");
    if (profileError && !missingProfilesTable) {
      logBoot('profile', 'error', { message: profileError.message || 'profile query failed' });
      throw profileError;
    }

    var authRole = authUser.app_metadata?.role || authUser.user_metadata?.role || 'USER';
    var authActive = authUser.app_metadata?.is_active ?? authUser.user_metadata?.is_active ?? true;
    var authName = authUser.user_metadata?.full_name || authUser.email || 'Usuario';

    var resolvedRole = profile?.role || authRole;
    var resolvedActive = profile?.is_active ?? authActive;
    var resolvedName = profile?.name || authName;
    var resolvedEmail = profile?.email || authUser.email || '';

    logBoot('profile', 'complete', { missingTable: missingProfilesTable, hasProfile: Boolean(profile), inactive: resolvedActive === false });

    if (resolvedActive === false) {
      await sb.auth.signOut();
      throw new Error('Usuario inativo. Contate um administrador.');
    }

    var usaVm = await carregarAcessoVm(sb, deps.mapRole(resolvedRole));

    return {
      id: profile?.id || authUser.id,
      nome: resolvedName,
      email: resolvedEmail,
      papel: deps.mapRole(resolvedRole),
      role: String(resolvedRole || 'USER').toUpperCase(),
      ativo: resolvedActive !== false,
      loja_id: null,
      usa_vm: usaVm,
    };
  }

  function construirUsuarioFallback(deps, authUser, profile) {
    if (!authUser) return null;

    var authRole = authUser.app_metadata?.role || authUser.user_metadata?.role || 'USER';
    var authActive = authUser.app_metadata?.is_active ?? authUser.user_metadata?.is_active ?? true;
    var authName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email || 'Usuario';
    var profileRole = profile?.role || authRole;
    var profileActive = profile?.is_active ?? authActive;

    return {
      id: profile?.id || authUser.id,
      nome: profile?.name || authName,
      email: profile?.email || authUser.email || '',
      papel: deps.mapRole(profileRole),
      role: String(profileRole || 'USER').toUpperCase(),
      ativo: profileActive !== false,
      loja_id: null,
    };
  }

  async function signOutInactiveUser(deps, message) {
    var sb = null;
    try {
      sb = await ensureSb(deps);
    } catch (error) {
      console.warn('Nao foi possivel inicializar o Supabase ao bloquear usuario inativo:', error && error.message ? error.message : error);
    }

    try {
      if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
        await sb.auth.signOut();
      }
    } catch (error) {
      console.warn('Nao foi possivel encerrar a sessao do usuario inativo:', error && error.message ? error.message : error);
    }

    await deps.setCurrentUser(null);
    throw new Error(message || 'Usuario inativo. Contate um administrador.');
  }

  function getLoginRedirectTarget() {
    var url = new URL(window.location.href);
    var redirect = url.searchParams.get('redirect');
    if (redirect) {
      try {
        var targetUrl = new URL(redirect, window.location.origin);
        return targetUrl.pathname + targetUrl.search;
      } catch (error) {
        return '/dashboard';
      }
    }

    if (url.pathname === '/login') {
      return '/dashboard';
    }

    return url.pathname + url.search;
  }

  function getCurrentRouteTarget() {
    return window.location.pathname === '/'
      ? '/dashboard'
      : window.location.pathname + window.location.search;
  }

  function setAppVisibility(isVisible) {
    var app = document.getElementById('app');
    var loginScreen = document.getElementById('login-screen');
    var bootstrap = document.getElementById('bootstrap-screen');

    if (app) {
      app.classList.toggle('hidden', !isVisible);
    }

    if (loginScreen) {
      loginScreen.classList.toggle('hidden', isVisible);
    }

    if (bootstrap) {
      bootstrap.classList.add('hidden');
    }
  }

  function setBootstrapVisibility(isVisible) {
    var app = document.getElementById('app');
    var loginScreen = document.getElementById('login-screen');
    var bootstrap = document.getElementById('bootstrap-screen');

    if (app) app.classList.add('hidden');
    if (loginScreen) loginScreen.classList.add('hidden');
    if (bootstrap) bootstrap.classList.toggle('hidden', !isVisible);
  }

  function startBackendHeartbeat(deps) {
    if (backendHeartbeatId) {
      clearInterval(backendHeartbeatId);
      backendHeartbeatId = null;
    }

    backendHeartbeatId = setInterval(function checkBackendHeartbeat() {
      if (typeof deps.checkBackend === 'function') {
        deps.checkBackend();
      }
    }, 30000);
  }

  function stopBackendHeartbeat() {
    if (!backendHeartbeatId) return;
    clearInterval(backendHeartbeatId);
    backendHeartbeatId = null;
  }

  async function activateAuthenticatedSession(deps, usuario) {
    await deps.setCurrentUser(usuario);

    if (typeof deps.iniciarApp === 'function') {
      await deps.iniciarApp();
    }

    setBootstrapState('STARTING_ROUTER');

    if (window.location.pathname === '/login') {
      await deps.navigateTo(getLoginRedirectTarget() || '/dashboard', { replace: true, force: true });
      return;
    }

    if (typeof deps.handleRouteChange === 'function') {
      await deps.handleRouteChange({ force: true });
    }
  }

  async function fazerLogin(deps) {
    var email = document.getElementById('login-email').value.trim();
    var senha = document.getElementById('login-senha').value;
    var errEl = document.getElementById('login-error');
    var button = document.getElementById('login-btn');

    errEl.classList.add('hidden');
    if (!email || !senha) {
      errEl.textContent = 'Preencha login e senha.';
      errEl.classList.remove('hidden');
      return null;
    }

    button.disabled = true;
    button.innerHTML = '<span>Entrando...</span>';

    try {
      var sb = await ensureSb(deps);
      var signInResult = await sb.auth.signInWithPassword({ email: email, password: senha });
      if (signInResult.error) throw signInResult.error;

      var session = signInResult.data && signInResult.data.session;
      if (session && typeof sb.auth.setSession === 'function') {
        try {
          await sb.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        } catch (setSessionError) {
          console.warn('Nao foi possivel reafirmar a sessao do login:', setSessionError.message || setSessionError);
        }
      }

      var usuario;
      try {
        usuario = await carregarUsuarioAtual(deps);
      } catch (loadError) {
        if (isAuthSessionError(loadError) && session && typeof sb.auth.setSession === 'function') {
          await new Promise(function waitBeforeRetry(resolve) {
            setTimeout(resolve, 250);
          });

          try {
            await sb.auth.setSession({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            });
            usuario = await carregarUsuarioAtual(deps);
          } catch (retryError) {
            if (signInResult && signInResult.data && signInResult.data.user) {
              console.warn('Sessao ainda nao apareceu apos o login; usando fallback do usuario autenticado.');
              usuario = construirUsuarioFallback(deps, signInResult.data.user, null);
            } else {
              throw retryError;
            }
          }
        } else {
          if (signInResult && signInResult.data && signInResult.data.user) {
            console.warn('Falha ao carregar usuario apos o login; usando fallback do usuario autenticado.');
            usuario = construirUsuarioFallback(deps, signInResult.data.user, null);
          } else {
            throw loadError;
          }
        }
      }

      if (!usuario) {
        throw new Error('Sessao autenticada nao encontrada apos o login.');
      }

      if (usuario.ativo === false) {
        await signOutInactiveUser(deps, 'Usuario bloqueado. Contate um administrador.');
      }

      await activateAuthenticatedSession(deps, usuario);
      return usuario;
    } catch (error) {
      errEl.textContent = 'Erro de conexao: ' + error.message;
      errEl.classList.remove('hidden');
      return null;
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i><span>Entrar</span>';
      if (global.lucide && typeof global.lucide.createIcons === 'function') {
        global.lucide.createIcons();
      }
    }
  }

  async function fazerLogout(deps) {
    stopBackendHeartbeat();
    await deps.setCurrentUser(null);
    var sb = await ensureSb(deps);
    await sb.auth.signOut();
    await deps.navigateTo('/login?redirect=' + encodeURIComponent(getCurrentRouteTarget()), {
      replace: true,
      force: true,
    });

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  async function iniciarApp(deps) {
    var user = deps.getCurrentUser();
    if (!user) {
      return;
    }

    var initials = user.nome.split(' ').map(function mapName(part) { return part[0]; }).slice(0, 2).join('').toUpperCase();
    document.getElementById('sidebar-avatar').textContent = initials;
    document.getElementById('sidebar-username').textContent = user.nome;
    document.getElementById('sidebar-userrole').textContent = deps.papeis[user.papel]?.label || user.papel;

    var adminEl = document.getElementById('nav-admin');
    var lojasEl = document.getElementById('nav-lojas');
    // ponytail: nav-admin stays visible for all users (shows Minha Conta)
    // only lojas/usuarios are hidden by data-resource filtering in app-shell.js
    if (!['admin', 'gestora'].includes(user.papel)) {
      lojasEl?.classList.add('hidden');
    } else {
      adminEl?.classList.remove('hidden');
      lojasEl?.classList.remove('hidden');
    }

    logBoot('permissions', 'start');
    try {
      await deps.carregarPermissoes(user.papel);
      logBoot('permissions', 'complete');
    } catch (error) {
      logBoot('permissions', 'error', { message: error && error.message ? error.message : 'permissions failed' });
      throw error;
    }
    deps.aplicarPermissoes();

    if (typeof deps.checkBackend === 'function') {
      Promise.resolve()
        .then(function runBackendCheck() {
          return deps.checkBackend();
        })
        .catch(function ignoreBackendCheckError(error) {
          console.warn('Falha ao verificar backend:', error && error.message ? error.message : error);
        });
    }
    startBackendHeartbeat(deps);

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  async function afterRenderLogin(deps) {
    setAppVisibility(false);

    var form = document.getElementById('login-form');
    var email = document.getElementById('login-email');
    var senha = document.getElementById('login-senha');
    var toggle = document.getElementById('login-toggle-senha');

    if (form) {
      form.addEventListener('submit', function onSubmit(event) {
        event.preventDefault();
        fazerLogin(deps);
      });
    }

    if (toggle) {
      toggle.addEventListener('click', function onToggle(event) {
        event.preventDefault();
        toggleSenhaVisivel('login-senha', toggle);
      });
    }

    if (email) {
      email.focus();
    } else if (senha) {
      senha.focus();
    }

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  async function bootstrap(deps, options) {
    var opts = options || {};
    lastBootstrapDeps = deps;

    if (bootstrapPromise) return bootstrapPromise;

    if (opts.force && (bootstrapState.current === 'ERROR' || bootstrapState.current === 'READY_PUBLIC' || bootstrapState.current === 'READY_AUTHENTICATED')) {
      bootstrapPromise = null;
    }

    bootstrapPromise = runBootstrap(deps);
    bootstrapPromise = bootstrapPromise.finally(function resetBootstrapPromise() {
      bootstrapPromise = null;
    });

    return bootstrapPromise;
  }

  function enqueueAuthSync(task) {
    authSyncPromise = authSyncPromise
      .catch(function ignorePreviousAuthError() {})
      .then(task);
    return authSyncPromise;
  }

  async function handleAuthEvent(event, session, deps) {
    logAuth(event);

    if (authBootstrapping && (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      return;
    }

    if (event === 'SIGNED_OUT') {
      await deps.setCurrentUser(null);
      stopBackendHeartbeat();
      if (window.location.pathname !== '/login') {
        await deps.navigateTo('/login?redirect=' + encodeURIComponent(getCurrentRouteTarget()), {
          replace: true,
          force: true,
        });
      }
      return;
    }

    if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session && session.user) {
      await enqueueAuthSync(async function syncSignedInUser() {
        var usuario = await carregarUsuarioAtual(deps);
        if (usuario) {
          await activateAuthenticatedSession(deps, usuario);
        }
      });
    }
  }

  async function runBootstrap(deps) {
    var bootId = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : 'boot-' + Date.now();
    var diagnostics = getDiagnostics();

    if (typeof diagnostics.setBootstrapId === 'function') {
      diagnostics.setBootstrapId(bootId);
    }
    if (typeof diagnostics.setBootstrapRetryHandler === 'function') {
      diagnostics.setBootstrapRetryHandler(function retryBootstrap() {
        if (lastBootstrapDeps) {
          bootstrap(lastBootstrapDeps, { force: true });
        }
      });
    }

    logBoot('start');
    authBootstrapping = true;
    setBootstrapVisibility(true);
    // ponytail: capture initial URL before any async work modifies it
    var bootstrapStartRoute = window.location.pathname === '/'
      ? '/dashboard'
      : window.location.pathname + window.location.search;

    try {
      setBootstrapState('LOADING_CONFIG');
      setBootstrapState('CREATING_CLIENT');
      await deps.initSupabase();
      var sb = await ensureSb(deps);

      logBoot('auth-listener', 'start');
      if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function' && !global.__sferaAuthListenerBound) {
        global.__sferaAuthListenerBound = true;
        sb.auth.onAuthStateChange(async function onAuthStateChange(event, session) {
          try {
            await handleAuthEvent(event, session, deps);
          } catch (error) {
            console.warn('Falha ao sincronizar sessao:', error.message);
          }
        });
      }
      logBoot('auth-listener', 'complete');

      setBootstrapState('RESTORING_SESSION');
      logBoot('session', 'start');
      var sessionResult;
      try {
        sessionResult = await withTimeout('getSession', sb.auth.getSession(), 8000);
      } catch (error) {
        logBoot('session', 'error', { message: error && error.message ? error.message : 'session timeout' });
        throw error;
      }

      if (sessionResult.error) {
        logBoot('session', 'error', { message: sessionResult.error.message || 'session error' });
        throw sessionResult.error;
      }
      logBoot('session', 'complete', { hasSession: Boolean(sessionResult.data?.session) });

      if (sessionResult.data?.session) {
        setBootstrapState('VALIDATING_USER');
        setBootstrapState('LOADING_PROFILE');
        var usuario = await carregarUsuarioAtual(deps);
        if (usuario) {
          setBootstrapState('BUILDING_PERMISSIONS');
          // restore original URL in case Supabase auth init modified it (detectSessionInUrl)
          var currentPath = window.location.pathname + window.location.search;
          var currentNormalized = currentPath === '/' ? '/dashboard' : currentPath;
          if (currentNormalized !== bootstrapStartRoute) {
            window.history.replaceState({}, '', bootstrapStartRoute);
          }
          await activateAuthenticatedSession(deps, usuario);
          authBootstrapping = false;
          setBootstrapState('READY_AUTHENTICATED');
          logBoot('ready-authenticated');
          return;
        }
      }

      authBootstrapping = false;
      await deps.setCurrentUser(null);
      setBootstrapState('STARTING_ROUTER');
      if (window.location.pathname !== '/login') {
        await deps.navigateTo('/login?redirect=' + encodeURIComponent(bootstrapStartRoute), {
          replace: true,
          force: true,
        });
      } else if (typeof deps.handleRouteChange === 'function') {

        await deps.handleRouteChange({ force: true });
      }

      setBootstrapState('READY_PUBLIC');
      logBoot('ready-public');
      if (global.lucide && typeof global.lucide.createIcons === 'function') {
        global.lucide.createIcons();
      }
      return;
    } catch (error) {
      if (isAuthSessionError(error)) {
        console.warn('Falha ao restaurar sessao:', error.message);
        authBootstrapping = false;
        await deps.setCurrentUser(null);
        setBootstrapState('STARTING_ROUTER');

        if (window.location.pathname !== '/login') {
          await deps.navigateTo('/login?redirect=' + encodeURIComponent(bootstrapStartRoute), {
            replace: true,
            force: true,
          });
        } else if (typeof deps.handleRouteChange === 'function') {
          await deps.handleRouteChange({ force: true });
        }

        setBootstrapState('READY_PUBLIC');
        logBoot('ready-public');
        return;
      }

      logBoot('error', null, { message: error && error.message ? error.message : 'bootstrap failed' });
      console.warn('Falha ao restaurar sessao:', error.message);
      authBootstrapping = false;
      await deps.setCurrentUser(null);
      setBootstrapState('ERROR', { message: error && error.message ? error.message : 'bootstrap failed' });
      if (typeof deps.showBootstrapError === 'function') {
        deps.showBootstrapError(error, {
          retry: function retryBootstrap() {
            bootstrap(lastBootstrapDeps || deps, { force: true });
          },
        });
      } else {
        setBootstrapVisibility(true);
      }
      return;
    }
  }

  global.AuthModule = {
    bootstrap: bootstrap,
    carregarUsuarioAtual: carregarUsuarioAtual,
    afterRenderLogin: afterRenderLogin,
    fazerLogin: fazerLogin,
    fazerLogout: fazerLogout,
    iniciarApp: iniciarApp,
    toggleSenhaVisivel: toggleSenhaVisivel,
  };
})(window);
