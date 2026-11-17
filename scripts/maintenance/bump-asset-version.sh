#!/usr/bin/env bash
# Atualiza a versão dos arquivos do frontend (cache-busting).
# Troca APP_VERSION e todos os "?v=..." de public/index.html por AAAAMMDD-N,
# para o navegador buscar os arquivos novos depois de cada deploy.
#
# Uso (na raiz do projeto):  bash scripts/maintenance/bump-asset-version.sh
set -euo pipefail

INDEX="public/index.html"
[ -f "$INDEX" ] || { echo "Rode na raiz do projeto (não achei $INDEX)." >&2; exit 1; }

ATUAL=$(grep -o "APP_VERSION = '[^']*'" "$INDEX" | head -n1 | sed "s/APP_VERSION = '//; s/'//")
[ -n "$ATUAL" ] || { echo "APP_VERSION não encontrado em $INDEX." >&2; exit 1; }

HOJE=$(date +%Y%m%d)
if [ "${ATUAL%%-*}" = "$HOJE" ]; then
  NOVO="$HOJE-$(( ${ATUAL##*-} + 1 ))"
else
  NOVO="$HOJE-1"
fi

sed -i "s/${ATUAL}/${NOVO}/g" "$INDEX"
echo "Versão dos arquivos: ${ATUAL} -> ${NOVO}"
