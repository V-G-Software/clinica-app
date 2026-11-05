-- Papéis e banco, rodado uma vez por um superusuário (psql -U postgres -f scripts/papeis.sql).
-- clinica_dono: dono das tabelas, só para migrations. clinica_app: a aplicação — sem BYPASSRLS, sem ser
-- dona de nada, então RLS (FORCE) vale para ela sempre. Troque as senhas fora do desenvolvimento.
CREATE ROLE clinica_dono LOGIN PASSWORD 'dono_local' NOSUPERUSER NOCREATEROLE;
CREATE ROLE clinica_app LOGIN PASSWORD 'app_local' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE clinica OWNER clinica_dono;
REVOKE ALL ON DATABASE clinica FROM PUBLIC;
GRANT CONNECT ON DATABASE clinica TO clinica_app;
