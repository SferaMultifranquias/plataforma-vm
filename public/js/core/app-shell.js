(function initAppShellModule(global) {
  var sidebarOpen = true;
  var toastTimer = null;
  var perms = {};
  var currentRouteSignature = '';
  var currentRoutePath = '';
  var pendingRouteSignature = '';
  var renderedRouteSignature = '';
  var renderGeneration = 0;
  var currentCleanup = null;
  var navListenersBound = false;
  var popstateBound = false;
  var routerContext = {
    API_OK: function API_OK() {
      return false;
    },
    afterRenderForm: function afterRenderForm() {
      return Promise.resolve();
    },
    carregarLojas: function carregarLojas() {
      return Promise.resolve([]);
    },
    carregarPedido: function carregarPedido() {
      return Promise.resolve(null);
    },
    carregarPedidos: function carregarPedidos() {
      return Promise.resolve([]);
    },
    carregarStats: function carregarStats() {
      return Promise.resolve({});
    },
    canConfirmReceipt: function canConfirmReceipt() {
      return false;
    },
    canDeleteOrder: function canDeleteOrder() {
      return false;
    },
    canFillPlacedValues: function canFillPlacedValues() {
      return false;
    },
    canMarkOrderPlaced: function canMarkOrderPlaced() {
      return false;
    },
    decidirPedidoAPI: function decidirPedidoAPI() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    confirmReceiptAPI: function confirmReceiptAPI() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    enqueueRouteRefresh: function enqueueRouteRefresh() {
      return Promise.resolve();
    },
    fillPlacedValuesAPI: function fillPlacedValuesAPI() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    getCurrentUser: function getCurrentUser() {
      return null;
    },
    getSb: function getSb() {
      return null;
    },
    markOrderPlacedAPI: function markOrderPlacedAPI() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    listOrdersForCurrentProfile: function listOrdersForCurrentProfile() {
      return Promise.resolve([]);
    },
    listUsers: function listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
    createUser: function createUser() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    updateUser: function updateUser() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    deleteUser: function deleteUser() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    validateImport: function validateImport() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    importUsers: function importUsers() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    exportUsers: function exportUsers() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    navigateTo: function navigateTo() {
      return Promise.resolve();
    },
    initSupabase: function initSupabase() {
      return Promise.reject(new Error('Router context not configured.'));
    },
    iniciarApp: function iniciarApp() {
      return Promise.resolve();
    },
    mapRole: function mapRole(role) {
      return role;
    },
    setCurrentUser: function setCurrentUser() {
      return Promise.resolve();
    },
    renderDashboard: null,
    renderDrawerHistory: function renderDrawerHistory() {
      return '';
    },
    renderDrawerItems: function renderDrawerItems() {
      return '';
    },
    renderDrawerStatusBar: function renderDrawerStatusBar() {
      return '';
    },
    showPage: function showPage() {
      return Promise.resolve();
    },
    showToast: function showToast() {},
    statCard: null,
    statusBadge: function statusBadge() {
      return '';
    },
    waveCard: null,
  };

  function ensureListeners() {
    if (navListenersBound) return;
    navListenersBound = true;

    // Trocar de aba dentro de Suprimentos muda a URL (?aba=) sem recarregar; o menu acompanha.
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('sup:aba', function onSupAba() {
        updateActiveNavigation(window.location.pathname);
      });
    }

    document.addEventListener('click', function handleDocumentClick(event) {
      var link = event.target && event.target.closest('a[data-route]');
      if (!link) return;

      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        link.target === '_blank'
      ) {
        return;
      }

      var href = link.getAttribute('href') || link.getAttribute('data-route');
      if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) {
        return;
      }

      event.preventDefault();
      navigateTo(href);
    });

    var sidebarToggle = document.getElementById('sidebar-toggle-btn');
    if (sidebarToggle && !sidebarToggle.dataset.bound) {
      sidebarToggle.addEventListener('click', function onSidebarToggle() {
        toggleSidebar();
      });
      sidebarToggle.dataset.bound = 'true';
    }

    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.addEventListener('click', function onLogout() {
        fazerLogout();
      });
      logoutBtn.dataset.bound = 'true';
    }
  }

  function ensurePopstateListener() {
    if (popstateBound) return;
    popstateBound = true;
    window.addEventListener('popstate', function onPopState() {
      handleRouteChange({ force: true });
    });
  }

  function normalizePath(pathname) {
    if (!pathname || pathname === '/') return '/dashboard';
    return pathname.replace(/\/+$/, '') || '/dashboard';
  }

  function getRouteList() {
    return [
      {
        path: '/dashboard',
        key: 'dashboard',
        resource: 'dashboard',
        title: 'Dashboard',
        subtitle: 'Visão geral do sistema VM',
        render: function renderDashboard() {
          if (!global.DashboardModule || typeof global.DashboardModule.renderDashboard !== 'function') return '';
          return global.DashboardModule.renderDashboard({
            statCard: routerContext.statCard,
            waveCard: routerContext.waveCard,
          });
        },
        init: function initDashboard(deps) {
          if (!global.DashboardModule || typeof global.DashboardModule.afterRenderDashboard !== 'function') return Promise.resolve();
          return global.DashboardModule.afterRenderDashboard({
            carregarPedidos: deps.carregarPedidos,
            carregarStats: deps.carregarStats,
            listOrdersForCurrentProfile: deps.listOrdersForCurrentProfile,
            statusBadge: deps.statusBadge,
            getSb: deps.getSb,
            getCurrentUser: deps.getCurrentUser,
            showToast: deps.showToast,
          });
        },
      },
      {
        path: '/login',
        key: 'login',
        resource: 'login',
        public: true,
        title: 'Entrar',
        subtitle: 'Acesse sua conta para continuar.',
        mountId: 'login-screen',
        template: '/pages/login.html',
        init: function initLogin(deps) {
          if (!global.AuthModule || typeof global.AuthModule.afterRenderLogin !== 'function') return Promise.resolve();
          return global.AuthModule.afterRenderLogin(deps);
        },
      },
      {
        path: '/pedidos',
        key: 'pedidos',
        resource: 'pedidos',
        title: 'Pedidos',
        subtitle: function subtitlePedidos() {
          var currentUser = routerContext.getCurrentUser ? routerContext.getCurrentUser() : null;
          return currentUser && currentUser.papel === 'admin'
            ? 'Analise e acompanhe todos os pedidos enviados.'
            : 'Acompanhe os pedidos das lojas às quais você tem acesso.';
        },
        template: '/pages/pedidos.html',
        init: function initPedidos(deps) {
          if (!global.OrdersModule || typeof global.OrdersModule.afterRenderPedidos !== 'function') return Promise.resolve();
          return global.OrdersModule.afterRenderPedidos({
            API_OK: deps.API_OK,
            canConfirmReceipt: deps.canConfirmReceipt,
            canEditOrder: deps.canEditOrder,
            canDeleteOrder: deps.canDeleteOrder,
            canFillPlacedValues: deps.canFillPlacedValues,
            canMarkOrderPlaced: deps.canMarkOrderPlaced,
            confirmReceiptAPI: deps.confirmReceiptAPI,
            fillPlacedValuesAPI: deps.fillPlacedValuesAPI,
            getCurrentUser: deps.getCurrentUser,
            listOrdersForCurrentProfile: deps.listOrdersForCurrentProfile,
            navigateTo: deps.navigateTo,
            markOrderPlacedAPI: deps.markOrderPlacedAPI,
            showPage: deps.showPage,
            showToast: deps.showToast,
            statusBadge: deps.statusBadge,
          });
        },
      },
      {
        path: '/usuarios',
        key: 'usuarios',
        resource: 'usuarios',
        title: 'Usuários',
        subtitle: 'Gerencie acessos, perfis e lojas.',
        template: '/pages/usuarios.html',
        init: function initUsuarios(deps) {
          if (!global.UsersModule || typeof global.UsersModule.afterRenderUsuarios !== 'function') return Promise.resolve();
          return global.UsersModule.afterRenderUsuarios({
            createUser: deps.createUser,
            deleteUser: deps.deleteUser,
            exportUsers: deps.exportUsers,
            getCurrentUser: deps.getCurrentUser,
            getSb: deps.getSb,
            importUsers: deps.importUsers,
            listUsers: deps.listUsers,
            navigateTo: deps.navigateTo,
            params: deps.params,
            profile: deps.profile,
            role: deps.role,
            showToast: deps.showToast,
            updateUser: deps.updateUser,
            supabase: deps.supabase,
            validateImport: deps.validateImport,
          });
        },
        destroy: function destroyUsuarios() {
          if (global.UsersModule && typeof global.UsersModule.beforeLeave === 'function') {
            return global.UsersModule.beforeLeave();
          }
          return Promise.resolve();
        },
      },
      {
        path: '/novo-pedido',
        key: 'formulario',
        resource: 'formulario',
        title: 'Novo Pedido',
        subtitle: 'Cadastre um novo pedido de material.',
        template: '/pages/novo-pedido.html',
        init: function initFormulario(deps) {
          if (!global.FormModule || typeof global.FormModule.afterRenderFormulario !== 'function') return Promise.resolve();
          return global.FormModule.afterRenderFormulario({
            API_OK: deps.API_OK,
            afterRenderForm: deps.afterRenderForm,
            carregarLojas: deps.carregarLojas,
            carregarPedido: deps.carregarPedido,
            carregarPedidos: deps.carregarPedidos,
            enviarPedidoAPI: deps.enviarPedidoAPI,
            getCurrentUser: deps.getCurrentUser,
            getSb: deps.getSb,
            navigateTo: deps.navigateTo,
            params: deps.params,
            resubmitChangedOrderAPI: deps.resubmitChangedOrderAPI,
            showToast: deps.showToast,
            statusBadge: deps.statusBadge,
          });
        },
      },
      {
        path: '/lojas',
        key: 'lojas-cadastro',
        resource: 'lojas-cadastro',
        title: 'Lojas',
        subtitle: 'Gerencie as lojas disponíveis.',
        template: '/pages/lojas.html',
        init: function initStores(deps) {
          if (!global.StoresModule || typeof global.StoresModule.carregarTabelaLojas !== 'function') return Promise.resolve();
          return global.StoresModule.afterRenderLojasCadastro({
            sb: deps.getSb ? deps.getSb() : null,
            showToast: deps.showToast,
          });
        },
      },
      {
        path: '/suprimentos',
        key: 'suprimentos',
        resource: 'suprimentos',
        title: 'Suprimentos',
        subtitle: function subtitleSuprimentos() {
          var currentUser = routerContext.getCurrentUser ? routerContext.getCurrentUser() : null;
          return currentUser && currentUser.papel === 'admin'
            ? 'Solicitações de materiais de consumo e cadastro de itens das lojas.'
            : 'Informe o estoque que a loja tem hoje e envie a contagem para a Sfera.';
        },
        template: '/pages/suprimentos.html',
        init: function initSuprimentos(deps) {
          if (!global.SuppliesModule || typeof global.SuppliesModule.afterRenderSuprimentos !== 'function') return Promise.resolve();
          return global.SuppliesModule.afterRenderSuprimentos({
            getCurrentUser: deps.getCurrentUser,
            getSb: deps.getSb,
            navigateTo: deps.navigateTo,
            params: deps.params,
            showToast: deps.showToast,
          });
        },
        destroy: function destroySuprimentos() {
          if (global.SuppliesModule && typeof global.SuppliesModule.beforeLeave === 'function') {
            return global.SuppliesModule.beforeLeave();
          }
          return Promise.resolve();
        },
      },
      {
        path: '/dashboard-suprimentos',
        key: 'dashboard-suprimentos',
        resource: 'suprimentos',
        title: 'Dashboard Suprimentos',
        subtitle: 'Acompanhamento das solicitações de suprimentos.',
        template: '/pages/dashboard-suprimentos.html',
        init: function initDashboardSuprimentos(deps) {
          if (!global.SuppliesDashboardModule || typeof global.SuppliesDashboardModule.afterRenderDashboardSuprimentos !== 'function') return Promise.resolve();
          return global.SuppliesDashboardModule.afterRenderDashboardSuprimentos({
            getCurrentUser: deps.getCurrentUser,
            getSb: deps.getSb,
            navigateTo: deps.navigateTo,
            showToast: deps.showToast,
          });
        },
        destroy: function destroyDashboardSuprimentos() {
          if (global.SuppliesDashboardModule && typeof global.SuppliesDashboardModule.beforeLeave === 'function') {
            return global.SuppliesDashboardModule.beforeLeave();
          }
          return Promise.resolve();
        },
      },
      {
        path: '/estoque',
        key: 'estoque',
        resource: 'stock-checks-read',
        title: 'Estoque',
        subtitle: 'Análise de itens solicitados e recebidos.',
        template: '/pages/estoque.html',
        init: function initEstoque(deps) {
          if (!global.StockCheckModule || typeof global.StockCheckModule.afterRenderEstoque !== 'function') return Promise.resolve();
          return global.StockCheckModule.afterRenderEstoque({
            getCurrentUser: deps.getCurrentUser,
            getSb: deps.getSb,
            showToast: deps.showToast,
          });
        },
      },
    ];
  }

  var PAGE_ROUTES = {};
  getRouteList().forEach(function registerRoute(route) {
    PAGE_ROUTES[route.path] = route;
  });

  function getRouteByPath(pathname) {
    var normalized = normalizePath(pathname);
    return PAGE_ROUTES[normalized] || null;
  }

  function getRouteByKey(pageKey) {
    var routeList = Object.values(PAGE_ROUTES);
    return routeList.find(function findRoute(route) {
      return route.key === pageKey;
    }) || null;
  }

  function getPageContext(route, params) {
    var currentUser = routerContext.getCurrentUser ? routerContext.getCurrentUser() : null;
    return {
      API_OK: routerContext.API_OK,
      afterRenderForm: routerContext.afterRenderForm,
      carregarLojas: routerContext.carregarLojas,
      carregarPedido: routerContext.carregarPedido,
      carregarPedidos: routerContext.carregarPedidos,
      carregarStats: routerContext.carregarStats,
      canConfirmReceipt: routerContext.canConfirmReceipt,
      canDeleteOrder: routerContext.canDeleteOrder,
      canFillPlacedValues: routerContext.canFillPlacedValues,
      canMarkOrderPlaced: routerContext.canMarkOrderPlaced,
      decidirPedidoAPI: routerContext.decidirPedidoAPI,
      confirmReceiptAPI: routerContext.confirmReceiptAPI,
      fillPlacedValuesAPI: routerContext.fillPlacedValuesAPI,
      enqueueRouteRefresh: routerContext.enqueueRouteRefresh,
      getCurrentUser: routerContext.getCurrentUser,
      getSb: routerContext.getSb,
      listOrdersForCurrentProfile: routerContext.listOrdersForCurrentProfile,
      listUsers: routerContext.listUsers,
      createUser: routerContext.createUser,
      updateUser: routerContext.updateUser,
      deleteUser: routerContext.deleteUser,
      validateImport: routerContext.validateImport,
      importUsers: routerContext.importUsers,
      exportUsers: routerContext.exportUsers,
      enviarPedidoAPI: routerContext.enviarPedidoAPI,
      iniciarApp: routerContext.iniciarApp,
      initSupabase: routerContext.initSupabase,
      mapRole: routerContext.mapRole,
      navigateTo: navigateTo,
      params: params,
      profile: currentUser,
      renderDrawerHistory: routerContext.renderDrawerHistory,
      renderDrawerItems: routerContext.renderDrawerItems,
      renderDrawerStatusBar: routerContext.renderDrawerStatusBar,
      markOrderPlacedAPI: routerContext.markOrderPlacedAPI,
      resubmitChangedOrderAPI: routerContext.resubmitChangedOrderAPI,
      route: route,
      role: currentUser ? currentUser.papel : null,
      showPage: showPage,
      showToast: routerContext.showToast,
      statCard: routerContext.statCard,
      statusBadge: routerContext.statusBadge,
      canEditOrder: global.AppUtils && global.AppUtils.canEditOrder,
      setCurrentUser: routerContext.setCurrentUser,
      supabase: routerContext.getSb ? routerContext.getSb() : null,
      waveCard: routerContext.waveCard,
    };
  }

  function renderLoadingState(content) {
    content.innerHTML =
      '<section class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 animate-in">' +
        '<p class="text-sm text-slate-500">Carregando página...</p>' +
      '</section>';
  }

  function renderNotFoundState(content) {
    content.innerHTML =
      '<section class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 animate-in space-y-4">' +
        '<div>' +
          '<h2 class="text-base font-semibold text-slate-900 mb-2">Página não encontrada</h2>' +
          '<p class="text-sm text-slate-500">A rota solicitada não está disponível.</p>' +
        '</div>' +
        '<button type="button" id="route-back-dashboard" class="btn-primary">Voltar ao dashboard</button>' +
      '</section>';

    var backButton = document.getElementById('route-back-dashboard');
    if (backButton) {
      backButton.addEventListener('click', function backToDashboard() {
        navigateTo('/dashboard', { replace: true });
      });
    }
  }

  function renderUnauthorizedState(content) {
    content.innerHTML =
      '<section class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 animate-in space-y-4">' +
        '<div>' +
          '<h2 class="text-base font-semibold text-slate-900 mb-2">Acesso não autorizado</h2>' +
          '<p class="text-sm text-slate-500">Você não possui permissão para acessar esta página.</p>' +
        '</div>' +
        '<button type="button" id="route-back-home" class="btn-primary">Voltar ao dashboard</button>' +
      '</section>';

    var backButton = document.getElementById('route-back-home');
    if (backButton) {
      backButton.addEventListener('click', function backToDashboard() {
        navigateTo('/dashboard', { replace: true });
      });
    }
  }

  function renderPartialLoadError(content, route, error) {
    console.error('[router] partial load failed:', route && route.path, route && route.template, error);
    content.innerHTML =
      '<section class="bg-white border border-red-200 rounded-xl shadow-sm p-6 animate-in space-y-4">' +
        '<div>' +
          '<h2 class="text-base font-semibold text-red-700 mb-2">Erro ao carregar página</h2>' +
          '<p class="text-sm text-red-600">Não foi possível carregar o conteúdo solicitado.</p>' +
        '</div>' +
        '<button type="button" id="route-retry" class="btn-secondary">Tentar novamente</button>' +
      '</section>';

    var retry = document.getElementById('route-retry');
    if (retry) {
      retry.addEventListener('click', function retryRoute() {
        navigateTo(window.location.pathname + window.location.search, { replace: true, force: true });
      });
    }
  }

  function refreshIcons() {
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function updateShellTitle(route, params) {
    var title = typeof route.title === 'function' ? route.title(routerContext, params) : route.title;
    var subtitle = typeof route.subtitle === 'function' ? route.subtitle(routerContext, params) : route.subtitle;
    var titleEl = document.getElementById('page-title');
    var subtitleEl = document.getElementById('page-subtitle');

    if (titleEl) titleEl.textContent = title || '';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    document.title = (title || 'Sfera VM') + ' | Sfera VM';
  }

  function setShellVisibility(route) {
    var app = document.getElementById('app');
    var loginScreen = document.getElementById('login-screen');
    var bootstrap = document.getElementById('bootstrap-screen');
    var publicRoute = Boolean(route && route.public);

    if (app) {
      app.classList.toggle('hidden', publicRoute);
    }

    if (loginScreen) {
      loginScreen.classList.toggle('hidden', !publicRoute);
    }

    if (bootstrap) {
      bootstrap.classList.add('hidden');
    }
  }

  function getRouteMount(route) {
    var mountId = route && route.mountId ? route.mountId : 'content';
    return document.getElementById(mountId);
  }

  function updateActiveNavigation(pathname) {
    var normalized = normalizePath(pathname);
    var searchAba = '';
    try {
      searchAba = new URLSearchParams(window.location.search).get('aba') || '';
    } catch (err) {
      searchAba = '';
    }
    // O título da lateral acompanha a área: Suprimentos ou VM.
    var brandTitle = document.getElementById('sidebar-brand-title');
    if (brandTitle) {
      brandTitle.textContent = normalized === '/suprimentos' || normalized === '/dashboard-suprimentos' ? 'Sfera Suprimentos' : 'Sfera VM';
    }
    // O botão "Novo Pedido" do cabeçalho é do VM: não aparece dentro de Suprimentos.
    var headerNovoPedido = document.getElementById('header-novo-pedido');
    if (headerNovoPedido && headerNovoPedido.classList) {
      headerNovoPedido.classList.toggle('hidden', normalized === '/suprimentos' || normalized === '/dashboard-suprimentos');
    }
    // Em Suprimentos a loja faz o pedido ali mesmo (contagem + enviar), não no formulário do VM.
    var headerNovoPedidoSup = document.getElementById('header-novo-pedido-sup');
    if (headerNovoPedidoSup && headerNovoPedidoSup.classList) {
      headerNovoPedidoSup.classList.toggle('hidden', normalized !== '/suprimentos' && normalized !== '/dashboard-suprimentos');
    }
    document.querySelectorAll('a[data-route].nav-item').forEach(function updateLink(link) {
      var linkPath = link.getAttribute('data-route');
      var active = linkPath === normalized;
      var supAba = link.getAttribute('data-sup-aba');
      if (active && supAba) {
        var abasDoItem = [supAba].concat((link.getAttribute('data-sup-abas-extra') || '').split(' '));
        active = searchAba ? abasDoItem.indexOf(searchAba) !== -1 : link.hasAttribute('data-sup-default');
      }
      link.classList.toggle('bg-blue-600', active);
      link.classList.toggle('text-white', active);
      link.classList.toggle('font-medium', active);
      link.classList.toggle('text-slate-300', !active);
      link.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function canAccess(recurso, deps) {
    if (typeof deps.canAccessResource !== 'function') {
      console.error('[AppShellModule] Missing canAccessResource dependency');
      return false;
    }
    return deps.canAccessResource(deps.getCurrentUser(), perms, recurso);
  }

  function aplicarPermissoes(deps) {
    document.querySelectorAll('[data-resource]').forEach(function updateResourceVisibility(element) {
      var resource = element.getAttribute('data-resource');
      var allowed = canAccess(resource, deps);
      element.style.display = allowed ? '' : 'none';
    });

    // Menu de Suprimentos: itens do admin e itens da loja não se misturam.
    var supUser = deps.getCurrentUser ? deps.getCurrentUser() : null;
    var supPapel = supUser && supUser.papel === 'admin' ? 'admin' : 'loja';
    document.querySelectorAll('[data-sup-papel]').forEach(function filterSupMenu(element) {
      if (element.getAttribute('data-sup-papel') !== supPapel) element.style.display = 'none';
    });

    var adminGroup = document.getElementById('nav-admin');
    if (adminGroup) {
      var usuarios = document.getElementById('nav-usuarios');
      var lojas = document.getElementById('nav-lojas');
      var accountBtn = document.getElementById('account-open-btn');
      var hasVisible = (usuarios && usuarios.style.display !== 'none') || (lojas && lojas.style.display !== 'none');
      if (accountBtn && accountBtn.style.display !== 'none') hasVisible = true;
      adminGroup.style.display = hasVisible ? '' : 'none';
    }
  }

  async function clearCurrentPage() {
    if (currentCleanup) {
      try {
        await Promise.resolve(currentCleanup());
      } catch (cleanupError) {
        console.warn('Erro ao sair da pagina anterior:', currentRoutePath, cleanupError);
      } finally {
        currentCleanup = null;
      }
    }
  }

  async function loadPagePartial(templatePath) {
    var version = global.APP_VERSION || 'dev';
    var url = templatePath.indexOf('?') === -1 ? templatePath + '?v=' + encodeURIComponent(version) : templatePath;
    var response;
    try {
      var request = fetch(url, {
        headers: {
          Accept: 'text/html',
        },
      });
      response = global.AppDiagnostics && typeof global.AppDiagnostics.withTimeout === 'function'
        ? await global.AppDiagnostics.withTimeout('route partial fetch', request, 8000)
        : await request;
    } catch (error) {
      throw error;
    }

    if (!response.ok) {
      throw new Error('Não foi possível carregar a página: ' + templatePath);
    }

    return response.text();
  }

  function showRuntimeBanner(error, context) {
    if (global.AppDiagnostics && typeof global.AppDiagnostics.showRuntimeError === 'function') {
      global.AppDiagnostics.showRuntimeError(error, context);
      return;
    }

    console.error('[runtime-error]', error, context || '');
  }

  function routeHasVisibleContent(route) {
    var mount = getRouteMount(route || {});
    return Boolean(mount && String(mount.innerHTML || '').trim());
  }

  async function handleRouteChange(options) {
    var opts = options || {};
    var force = Boolean(opts.force);
    var locationUrl = new URL(window.location.href);
    var pathname = normalizePath(locationUrl.pathname);
    var search = locationUrl.search || '';
    var signature = pathname + search;
    var route = getRouteByPath(pathname);
    var currentUser = routerContext.getCurrentUser ? routerContext.getCurrentUser() : null;
    var params = Object.fromEntries(locationUrl.searchParams.entries());
    var generation = ++renderGeneration;

    if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
      global.AppDiagnostics.logBootstrapEvent('router', 'start', { path: pathname });
    }

    ensureListeners();
    ensurePopstateListener();

    if (window.location.pathname === '/' && pathname === '/dashboard') {
      window.history.replaceState({}, '', '/dashboard' + search);
    } else if (window.location.pathname !== pathname && pathname === '/dashboard' && !force && window.location.pathname === '/') {
      window.history.replaceState({}, '', '/dashboard' + search);
    }

    if (!force && signature === renderedRouteSignature && routeHasVisibleContent(route)) {
      return route;
    }

    if (!route) {
      var notFoundContent = document.getElementById('content');
      if (!notFoundContent) {
        console.error('Container principal #content nao encontrado');
        return null;
      }

      setShellVisibility(null);
      await clearCurrentPage();
      pendingRouteSignature = '';
      currentRouteSignature = signature;
      renderedRouteSignature = signature;
      currentRoutePath = pathname;
      var notFoundTitle = document.getElementById('page-title');
      var notFoundSubtitle = document.getElementById('page-subtitle');
      if (notFoundTitle) notFoundTitle.textContent = 'Página não encontrada';
      if (notFoundSubtitle) notFoundSubtitle.textContent = 'A rota solicitada não está disponível.';
      renderNotFoundState(notFoundContent);
      refreshIcons();
      updateActiveNavigation(pathname);
      if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
        global.AppDiagnostics.logBootstrapEvent('router', 'complete', { path: pathname, state: 'not-found' });
      }
      return null;
    }

    if (!route.public && !currentUser) {
      await navigateTo('/login?redirect=' + encodeURIComponent(pathname + search || '/dashboard'), {
        replace: true,
        force: true,
      });
      return null;
    }

    if (route.public && currentUser && route.path === '/login') {
      await navigateTo('/dashboard', { replace: true, force: true });
      return null;
    }

    var mount = getRouteMount(route);
    if (!mount) {
      console.error('Container da pagina nao encontrado:', route.mountId || 'content');
      return null;
    }

    setShellVisibility(route);

    var accessDeps = {
      canAccessResource: global.AppUtils && global.AppUtils.canAccessResource,
      getCurrentUser: routerContext.getCurrentUser,
    };
    if (!route.public && !canAccess(route.resource, accessDeps)) {
      // Usuários só de Suprimentos (lojas fora do VM) caem direto no módulo deles.
      var suppliesUser = routerContext.getCurrentUser && routerContext.getCurrentUser();
      if (suppliesUser && suppliesUser.usa_vm === false && route.path !== '/suprimentos' && canAccess('suprimentos', accessDeps)) {
        await navigateTo('/suprimentos', { replace: true, force: true });
        return null;
      }
      await clearCurrentPage();
      pendingRouteSignature = '';
      currentRouteSignature = signature;
      renderedRouteSignature = signature;
      currentRoutePath = pathname;
      var unauthorizedTitle = document.getElementById('page-title');
      var unauthorizedSubtitle = document.getElementById('page-subtitle');
      if (unauthorizedTitle) unauthorizedTitle.textContent = 'Acesso não autorizado';
      if (unauthorizedSubtitle) unauthorizedSubtitle.textContent = 'Você não possui permissão para acessar esta página.';
      renderUnauthorizedState(document.getElementById('content'));
      refreshIcons();
      updateActiveNavigation(pathname);
      if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
        global.AppDiagnostics.logBootstrapEvent('router', 'complete', { path: pathname, state: 'unauthorized' });
      }
      return null;
    }

    await clearCurrentPage();
    pendingRouteSignature = signature;
    currentRoutePath = pathname;
    updateShellTitle(route, params);
    renderLoadingState(mount);

    try {
      var html = '';
      if (route.template) {
        html = await loadPagePartial(route.template);
      } else if (typeof route.render === 'function') {
        html = route.render(getPageContext(route, params)) || '';
      }

      if (!String(html || '').trim()) {
        throw new Error('A rota nao retornou conteudo para renderizar.');
      }

      if (generation !== renderGeneration) {
        return null;
      }

      mount.innerHTML = html;
      if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
        global.AppDiagnostics.logBootstrapEvent('router', 'markup-ready', { path: pathname });
      }
      refreshIcons();

      var initPromise = null;
      if (typeof route.init === 'function') {
        try {
          initPromise = Promise.resolve(route.init(getPageContext(route, params)));
        } catch (initError) {
          initPromise = Promise.reject(initError);
        }

        Promise.resolve(initPromise)
          .catch(function handleRouteInitError(error) {
            if (generation !== renderGeneration) {
              return null;
            }

            if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
              global.AppDiagnostics.logBootstrapEvent('router', 'error', {
                message: error && error.message ? error.message : 'route init failed',
                path: pathname,
              });
            }

            renderPartialLoadError(mount, route, error);
            return null;
          });
      }

      if (generation !== renderGeneration) {
        return null;
      }

      currentCleanup = typeof route.destroy === 'function'
        ? route.destroy
        : typeof route.beforeLeave === 'function'
          ? route.beforeLeave
          : null;

      pendingRouteSignature = '';
      currentRouteSignature = signature;
      renderedRouteSignature = signature;
      refreshIcons();
      updateActiveNavigation(pathname);
      if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
        global.AppDiagnostics.logBootstrapEvent('router', 'complete', { path: pathname });
      }
      return route;
    } catch (error) {
      if (global.AppDiagnostics && typeof global.AppDiagnostics.logBootstrapEvent === 'function') {
        global.AppDiagnostics.logBootstrapEvent('router', 'error', {
          message: error && error.message ? error.message : 'route render failed',
          path: pathname,
        });
      }
      pendingRouteSignature = '';
      currentRouteSignature = signature;
      renderedRouteSignature = signature;
      renderPartialLoadError(mount, route, error);
      return null;
    }
  }

  function navigateTo(path, options) {
    var opts = options || {};
    var nextUrl = new URL(path, window.location.origin);
    var normalized = normalizePath(nextUrl.pathname) + (nextUrl.search || '');
    var current = window.location.pathname + window.location.search;

    if (!opts.force && normalized === current && routeHasVisibleContent(getRouteByPath(nextUrl.pathname))) {
      return Promise.resolve(getRouteByPath(nextUrl.pathname));
    }

    if (opts.replace) {
      window.history.replaceState({}, '', normalized);
    } else {
      window.history.pushState({}, '', normalized);
    }

    return handleRouteChange({ force: Boolean(opts.force) });
  }

  function resolvePageKey(pageKey) {
    return getRouteByKey(pageKey);
  }

  function showPage(pageKey) {
    var route = resolvePageKey(pageKey);
    if (!route) {
      var content = document.getElementById('content');
      if (content) {
        clearCurrentPage();
        setShellVisibility(null);
        renderNotFoundState(content);
        refreshIcons();
      }
      return Promise.resolve(null);
    }

    return navigateTo(route.path, { force: false });
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    var sidebar = document.getElementById('sidebar');
    var texts = document.querySelectorAll('.sidebar-text');
    var icon = document.getElementById('sidebar-toggle-icon');

    if (sidebarOpen) {
      sidebar.style.width = '260px';
      texts.forEach(function showText(element) {
        element.style.opacity = '1';
        element.style.visibility = 'visible';
        element.style.width = 'auto';
      });
      icon.setAttribute('data-lucide', 'panel-left-close');
    } else {
      sidebar.style.width = '56px';
      texts.forEach(function hideText(element) {
        element.style.opacity = '0';
        element.style.visibility = 'hidden';
        element.style.width = '0';
      });
      icon.setAttribute('data-lucide', 'panel-left-open');
    }

    refreshIcons();
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function hideToast() {
      toast.classList.add('hidden');
    }, 3000);

    refreshIcons();
  }

  function setRouterContext(nextContext) {
    routerContext = Object.assign({}, routerContext, nextContext || {});
    ensureListeners();
    ensurePopstateListener();
    return routerContext;
  }

  function getPageRoutes() {
    return PAGE_ROUTES;
  }

  global.AppShellModule = {
    aplicarPermissoes: aplicarPermissoes,
    canAccess: canAccess,
    carregarPermissoes: function carregarPermissoes(papel, deps) {
      perms = deps.buildPermissions(papel, deps.recursosAcesso, deps.opcoes);
    },
    getPageRoutes: getPageRoutes,
    handleRouteChange: handleRouteChange,
    loadPagePartial: loadPagePartial,
    navigateTo: navigateTo,
    setRouterContext: setRouterContext,
    showPage: showPage,
    showToast: showToast,
    toggleSidebar: toggleSidebar,
  };
})(window);
