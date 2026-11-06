#!/usr/bin/env bash
# Ensaio de restauração (14.4: "backup com recuperação point-in-time e RESTAURAÇÃO TESTADA").
# O PITR é do provedor (RDS/Cloud SQL/Neon); este ensaio prova o que importa depois de restaurar:
# o dump volta inteiro, com as mesmas linhas por tabela, e o isolamento (RLS forçado, papéis) volta junto.
# Uso (superusuário ou papel com CREATEDB):
#   ADMIN_URL=postgres://postgres@host/postgres ORIGEM_URL=postgres://clinica_backup@host/clinica ./scripts/ensaio-restauracao.sh
# ORIGEM_URL usa o papel clinica_backup (scripts/papeis.sql): com RLS forçado, nem o dono consegue o dump.
# Saída 0 = restauração confiável. Rode mensalmente e registre o resultado (docs/operacao/implantacao.md).
set -euo pipefail
: "${ADMIN_URL:?defina ADMIN_URL (conexão de administrador)}"
: "${ORIGEM_URL:?defina ORIGEM_URL (banco de origem, papel clinica_backup)}"
DESTINO=${DESTINO:-clinica_ensaio_$(date +%Y%m%d%H%M%S)}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $DESTINO" >/dev/null 2>&1 || true' EXIT

echo "1/4 dump da origem"
pg_dump --format=custom --no-owner --file "$TMP/clinica.dump" "$ORIGEM_URL"
echo "2/4 restauração em $DESTINO"
psql "$ADMIN_URL" -qc "CREATE DATABASE $DESTINO OWNER clinica_dono"
DEST_URL=$(python3 -c "import sys,urllib.parse as u;p=u.urlparse(sys.argv[1]);print(p._replace(path='/'+sys.argv[2]).geturl())" "$ADMIN_URL" "$DESTINO")
pg_restore --no-owner --role=clinica_dono --exit-on-error --dbname "$DEST_URL" "$TMP/clinica.dump"

echo "3/4 linhas por tabela (origem × restaurado)"
CONTAR="SELECT string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, true, '')))[1]::text), ' ' ORDER BY c.relname)
        FROM pg_class c WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace"
# Contagem pelo administrador nos dois lados: o RLS forçado esconderia as linhas do dono.
ORIG_ADMIN=$(python3 -c "import sys,urllib.parse as u;a=u.urlparse(sys.argv[1]);o=u.urlparse(sys.argv[2]);print(a._replace(path=o.path).geturl())" "$ADMIN_URL" "$ORIGEM_URL")
A=$(psql "$ORIG_ADMIN" -Atc "$CONTAR"); B=$(psql "$DEST_URL" -Atc "$CONTAR")
if [ "$A" != "$B" ]; then echo "DIVERGÊNCIA"; diff <(tr ' ' '\n' <<<"$A") <(tr ' ' '\n' <<<"$B") || true; exit 1; fi
echo "   $(tr ' ' '\n' <<<"$A" | wc -l) tabelas iguais"

echo "4/4 isolamento restaurado"
SEM=$(psql "$DEST_URL" -Atc "SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND NOT relrowsecurity")
[ "$SEM" = "organizacoes,schema_migracoes" ] || { echo "RLS faltando: $SEM"; exit 1; }
NAO_FORCADAS=$(psql "$DEST_URL" -Atc "SELECT string_agg(relname, ',') FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND relrowsecurity AND NOT relforcerowsecurity")
[ "$NAO_FORCADAS" = "jobs" ] || { echo "RLS não forçado em: $NAO_FORCADAS"; exit 1; }
GRANTS=$(psql "$DEST_URL" -Atc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='clinica_app'")
[ "$GRANTS" -gt 0 ] || { echo "papel clinica_app sem permissões no restaurado"; exit 1; }
echo "OK: restauração confiável ($DESTINO será removido)"
