# @huzhihui_c/mcp-postgres

一个参考 AWS Labs 安全模型实现的 PostgreSQL MCP Server：默认只读，显式使用 `--mode=write` 或 `--mode=admin` 才开启写操作。原生支持 `DATABASE_URL` 连接串与 PostgreSQL Schema 命名空间。

## 启动

默认只读：

```bash
pnpm --filter @huzhihui_c/mcp-postgres build
pnpm --filter @huzhihui_c/mcp-postgres start
```

写模式：

```bash
npx -y @huzhihui_c/mcp-postgres --mode=write
```

管理员模式：

```bash
npx -y @huzhihui_c/mcp-postgres --mode=admin
```

MCP 客户端配置示例（使用 DATABASE_URL 连接串，推荐）：

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:secret@127.0.0.1:5432/appdb"
      }
    }
  }
}
```

或者使用离散环境变量：

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-postgres"],
      "env": {
        "PGHOST": "127.0.0.1",
        "PGPORT": "5432",
        "PGUSER": "mcp_readonly",
        "PGPASSWORD": "runtime-secret",
        "PGDATABASE": "appdb",
        "PGSSL": "false"
      }
    }
  }
}
```

## 模式

- `readonly`：默认模式，只允许只读语句（`SELECT`、`TABLE`、`VALUES`、`SHOW`、`EXPLAIN` 以及只读 CTE `WITH ... SELECT`）。底层通过 `BEGIN TRANSACTION READ ONLY` 引擎级强制只读。
- `write`：允许查询、DML（`INSERT`、`UPDATE`、`DELETE`）和非破坏性表变更（`CREATE TABLE`、`ALTER TABLE`、`CREATE INDEX` 等）；严格禁止账户管理、破坏性 DDL（`DROP TABLE/SCHEMA`、`TRUNCATE`）和多语句。
- `admin`：允许单条 PostgreSQL 语句，包括破坏性 DDL（`DROP`、`TRUNCATE`）、`GRANT`、`REVOKE`、角色和权限管理语句。数据库账号本身必须拥有对应权限。

不要使用 superuser/postgres 超级管理员账号作为日常 MCP 账号。MCP 的 SQL 检查只是防御层，真正的安全边界是 PostgreSQL 的最小权限账号。

## 连接与生命周期

采用“按需单连接（用完即关）”设计：每次工具调用时异步建立独立连接，查询执行完毕后立即关闭底层物理 Socket。闲置时对 PostgreSQL 连接占用数为 0，彻底杜绝了因客户端长时间闲置被服务端 `idle_in_transaction_session_timeout` 或中间件（如 PgBouncer / RDS Proxy）超时踢断的问题。

## 环境变量

- `DATABASE_URL`：完整连接串，如 `postgres://user:pass@host:5432/db`。
- `PGHOST` / `POSTGRES_HOST`：PostgreSQL 主机，默认为 `127.0.0.1`。
- `PGPORT` / `POSTGRES_PORT`：PostgreSQL 端口，默认为 `5432`。
- `PGUSER` / `POSTGRES_USER`：PostgreSQL 用户名，默认为 `postgres`。
- `PGPASSWORD` / `POSTGRES_PASSWORD`：密码；也可以使用 `PGPASSWORD_FILE`。
- `PGDATABASE` / `POSTGRES_DB`：默认数据库，默认为 `postgres`。
- `PGSSL` / `POSTGRES_SSL`：是否启用 TLS，默认 `false`。
- `PGSSL_CA`：CA 证书路径。
- `PGSSL_REJECT_UNAUTHORIZED`：是否严格校验证书，默认 `false`。
- `PG_MODE`：`readonly`、`write` 或 `admin`，默认 `readonly`。
- `PG_MAX_ROWS`：最大返回行数，默认为 `500`。
- `PG_MAX_RESULT_BYTES`：最大返回结果字节数，默认为 `1048576`。
- `PG_QUERY_TIMEOUT_MS`：查询超时时间，默认为 `10000`。
- `PG_CONNECT_TIMEOUT_MS`：连接握手超时时间，默认为 `10000`。
- `PG_MAX_AFFECTED_ROWS`：非 admin 模式单次 DML 最大影响行数，默认为 `1000`。

命令行 `--mode` 优先于 `PG_MODE`。

## 工具

- `pg_query`：执行一条 SQL；默认只读。支持 `$1, $2` 占位符参数。
- `pg_get_server_info`：获取 PostgreSQL 版本、当前用户、当前数据库及默认 Schema。
- `pg_list_databases`：列出当前实例中可见的数据库列表。
- `pg_list_schemas`：列出当前数据库中的所有 Schema（命名空间，如 `public`）。
- `pg_list_tables`：列出指定 Schema（默认 `public`）下的表和视图。
- `pg_describe_table`：查看指定表的列定义、主键（primary keys）、外键约束映射（foreign keys）与索引定义（indexes）。

结果包含 `schema_version`、语句类型、列、行、影响行数等结构化信息；输出默认限制为 500 行和 1 MiB。
