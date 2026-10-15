const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'logs',
  'dist',
  'build',
  '.wrangler',
  '.next',
  '.turbo',
  'coverage',
  '.vite',
  '.cache',
  'functions',
]);

const checkedFiles = [];
const errors = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const ext = path.extname(entry.name);
    if (JS_EXTENSIONS.has(ext) || entry.name.endsWith('.html')) {
      checkedFiles.push(fullPath);
    }
  }
}

function validateScriptSyntax(code, fileLabel) {
  try {
    new vm.Script(code, { filename: fileLabel });
  } catch (error) {
    errors.push(`${fileLabel}: ${error.message}`);
  }
}

function extractInlineScripts(html, filePath) {
  const matches = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  matches.forEach((match, index) => {
    const code = (match[1] || '').trim();
    if (!code) return;
    validateScriptSyntax(code, `${filePath}#inline-script-${index + 1}`);
  });
}

function validatePartialMarkup(filePath, html) {
  const prohibitedPatterns = [
    [/<!doctype/i, 'DOCTYPE'],
    [/<html\b/i, '<html>'],
    [/<head\b/i, '<head>'],
    [/<body\b/i, '<body>'],
    [/<script\b/i, '<script>'],
    [/\bonclick\s*=/i, 'onclick'],
    [/\bonchange\s*=/i, 'onchange'],
    [/\bonsubmit\s*=/i, 'onsubmit'],
  ];

  prohibitedPatterns.forEach(([pattern, label]) => {
    if (pattern.test(html)) {
      errors.push(`${filePath}: partial HTML invalido -> ${label}`);
    }
  });
}

function validateNoInlineEvents(filePath, html) {
  var prohibitedPatterns = [
    [/\bonclick\s*=/i, 'onclick'],
    [/\bonchange\s*=/i, 'onchange'],
    [/\bonsubmit\s*=/i, 'onsubmit'],
    [/\bonerror\s*=/i, 'onerror'],
    [/\bonload\s*=/i, 'onload'],
    [/javascript:/i, 'javascript:'],
  ];
  prohibitedPatterns.forEach(function checkPattern(pair) {
    if (pair[0].test(html)) {
      errors.push(filePath + ': inline event handler encontrado -> ' + pair[1]);
    }
  });
}

function localReferenceExists(baseFile, requestPath) {
  const baseDir = path.dirname(baseFile);
  const resolved = path.resolve(baseDir, requestPath);
  const candidates = [
    resolved,
    `${resolved}.js`,
    `${resolved}.cjs`,
    `${resolved}.mjs`,
    `${resolved}.json`,
    path.join(resolved, 'index.js'),
    path.join(resolved, 'index.cjs'),
    path.join(resolved, 'index.mjs'),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function validateLocalReferences(code, filePath) {
  const patterns = [
    /require\(\s*['"](\.\/|\.\.\/)[^'"]+['"]\s*\)/g,
    /import\s+[^'"]*from\s+['"](\.\/|\.\.\/)[^'"]+['"]/g,
    /import\s*\(\s*['"](\.\/|\.\.\/)[^'"]+['"]\s*\)/g,
  ];

  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const literal = match[0];
      const requestMatch = literal.match(/['"]((?:\.\/|\.\.\/)[^'"]+)['"]/);
      const requestPath = requestMatch && requestMatch[1];
      if (!requestPath || seen.has(requestPath)) continue;
      seen.add(requestPath);
      if (!localReferenceExists(filePath, requestPath)) {
        errors.push(`${filePath}: referencia local inexistente -> ${requestPath}`);
      }
    }
  }
}

walk(ROOT);

for (const filePath of checkedFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath);
  if (filePath.endsWith('.html')) {
    extractInlineScripts(content, path.relative(ROOT, filePath));
    if (filePath.includes(`${path.sep}pages${path.sep}`)) {
      validatePartialMarkup(path.relative(ROOT, filePath), content);
    }
    if (relativePath === 'public/index.html') {
      validateNoInlineEvents(path.relative(ROOT, filePath), content);
    }
    continue;
  }

  validateScriptSyntax(content, path.relative(ROOT, filePath));
  validateLocalReferences(content, filePath);

  if (relativePath === path.join('public', 'js', 'pages', 'orders', 'orders-data.js') && /from\(\s*['"]orders['"]\s*\)\.insert\s*\(/.test(content)) {
    errors.push(`${relativePath}: proibido fallback direto com orders.insert no frontend`);
  }
}

if (errors.length > 0) {
  console.error('Check falhou.\n');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Check ok. ${checkedFiles.length} arquivo(s) verificado(s).`);
