-- Papéis e banco, rodado uma vez por um superusuário (psql -U postgres -f scripts/papeis.sql).
-- clinica_dono: dono das tabelas, só para migrations. clinica_app: a aplicação — sem BYPASSRLS, sem ser
-- dona de nada, então RLS (FORCE) vale para ela sempre. Troque as senhas fora do desenvolvimento.
CREATE ROLE clinica_dono LOGIN PASSWORD 'dono_local' NOSUPERUSER NOCREATEROLE;
CREATE ROLE clinica_app LOGIN PASSWORD 'app_local' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE clinica OWNER clinica_dono;
REVOKE ALL ON DATABASE clinica FROM PUBLIC;
GRANT CONNECT ON DATABASE clinica TO clinica_app;
-- clinica_backup: SÓ backup lógico (pg_dump). Com RLS forçado nem o dono consegue ler tudo — de propósito —
-- então o dump precisa de um papel que ignore RLS. Somente leitura (pg_read_all_data), sem escrita, sem
-- login da aplicação; senha num cofre separado e uso só pelo processo de backup/ensaio de restauração.
CREATE ROLE clinica_backup LOGIN PASSWORD 'backup_local' NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;
GRANT pg_read_all_data TO clinica_backup;
GRANT CONNECT ON DATABASE clinica TO clinica_backup;
