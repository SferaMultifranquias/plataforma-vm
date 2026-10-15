async function isVisible(page, selector, timeout) {
  return page.locator(selector).isVisible({ timeout }).catch(() => false);
}

async function openLogin(page, options) {
  const timeout = options && Number.isFinite(options.timeout) ? options.timeout : 10000;
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout });

  const path = new URL(page.url()).pathname;
  if (path !== '/login') {
    return { redirected: true, path };
  }

  const formVisible = await isVisible(page, '#login-form', Math.min(5000, timeout));
  if (!formVisible) {
    const bootstrapErrorVisible = await isVisible(page, '#bootstrap-screen[data-state="error"]', 1000);
    if (bootstrapErrorVisible) {
      throw new Error('Login bootstrap failed: bootstrap screen in error state.');
    }

    throw new Error(`Login form unavailable at ${page.url()}.`);
  }

  return { redirected: false, path };
}

async function submitLogin(page, email, password, options) {
  await openLogin(page, options);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-senha').fill(password);
  await page.locator('#login-btn').click();
}

async function login(page, email, password, options) {
  const timeout = options && Number.isFinite(options.timeout) ? options.timeout : 15000;

  if (await isVisible(page, '#users-page', 1000) || await isVisible(page, '#sidebar-username', 1000)) {
    return { alreadyAuthenticated: true };
  }

  await submitLogin(page, email, password, { timeout });

  const settled = await Promise.race([
    page.waitForURL(/\/(dashboard|usuarios)(\?.*)?$/, { timeout }).then(() => 'route'),
    page.locator('#login-error').waitFor({ state: 'visible', timeout }).then(() => 'login-error'),
    page.locator('#bootstrap-screen[data-state="error"]').waitFor({ state: 'visible', timeout }).then(() => 'bootstrap-error'),
  ]).catch((error) => {
    throw new Error(`Login did not settle within ${timeout}ms: ${error.message}`);
  });

  if (settled === 'login-error') {
    throw new Error(String(await page.locator('#login-error').textContent().catch(() => '') || 'Login rejected.').trim());
  }

  if (settled === 'bootstrap-error') {
    throw new Error('Login bootstrap failed.');
  }

  if (!(await isVisible(page, '#sidebar-username', 2000)) && !(await isVisible(page, '#users-page', 2000))) {
    throw new Error('Login completed but authenticated UI did not render.');
  }

  return { alreadyAuthenticated: false };
}

async function loginAsAdmin(page, credentials, options) {
  return login(page, credentials.email, credentials.password, options);
}

async function loginAsDisposableUser(page, email, password, options) {
  return login(page, email, password, options);
}

async function loginWithCleanSession(page, email, password, options) {
  const timeout = (options && Number.isFinite(options.timeout)) ? options.timeout : 15000;

  await page.evaluate(function () { localStorage.clear(); }).catch(function () {});
  await page.context().clearCookies();

  await page.goto('/login', { waitUntil: 'networkidle', timeout });
  await page.waitForSelector('#login-form', { state: 'visible', timeout: Math.min(10000, timeout) });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-senha').fill(password);
  await page.locator('#login-btn').click();
  await page.waitForURL(/\/(dashboard|pedidos)(\?.*)?$/, { timeout });
}

async function logout(page) {
  await page.locator('[title="Sair"]').click();
  await page.waitForURL(/\/login/);
}

module.exports = {
  login,
  loginAsAdmin,
  loginAsDisposableUser,
  loginWithCleanSession,
  logout,
  openLogin,
  submitLogin,
};
