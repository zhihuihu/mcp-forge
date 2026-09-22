# @huzhihui_c/mcp-kingbase

人大金仓 (KingbaseES) MCP Server，参考 AWS Labs 安全模型实现：默认只读 (`readonly`)，显式指定 `--mode=write` 或 `--mode=admin` 才开启写操作。

基于纯 JavaScript 的标准 PostgreSQL V3 协议驱动，零原生 C++ 编译依赖，跨平台开箱即用。原生支持返回 KingbaseES 的兼容模式（`database_mode`：`oracle`、`mysql` 或 `pg`），由 AI 大模型自动根据兼容模式生成对应方言的 SQL 语句。

## 快速启动

默认只读模式：

```bash
pnpm --filter @huzhihui_c/mcp-kingbase build
pnpm --filter @huzhihui_c/mcp-kingbase start
```

写模式：

```bash
npx -y @huzhihui_c/mcp-kingbase --mode=write --host 127.0.0.1 --port 54321 -u system -p your_password -d TEST
```

管理员模式：

```bash
npx -y @huzhihui_c/mcp-kingbase --mode=admin
```

## MCP 客户端配置示例

使用命令行参数配置：

```json
{
  "mcpServers": {
    "kingbase": {
      "command": "npx",
      "args": [
        "-y",
        "@huzhihui_c/mcp-kingbase",
        "--mode=readonly",
        "--host=127.0.0.1",
        "--port=54321",
        "--user=system",
        "--password=your_password",
        "--database=TEST"
      ]
    }
  }
}
```

或者使用环境变量：

```json
{
  "mcpServers": {
    "kingbase": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-kingbase"],
      "env": {
        "KINGBASE_HOST": "127.0.0.1",
        "KINGBASE_PORT": "54321",
        "KINGBASE_USER": "system",
        "KINGBASE_PASSWORD": "your_password",
        "KINGBASE_DATABASE": "TEST",
        "KINGBASE_MODE": "readonly"
      }
    }
  }
}
```

也可以使用连接串（`kingbase://` 或 `postgres://`）：

```json
{
  "mcpServers": {
    "kingbase": {
      "command": "npx",
      "args": [
        "-y",
        "@huzhihui_c/mcp-kingbase",
        "--connection-string=kingbase://system:your_password@127.0.0.1:54321/TEST"
      ]
    }
  }
}
```

## 三级安全模式

- `readonly`：默认模式。只允许查询语句（`SELECT`、`SHOW`、`EXPLAIN`、`TABLE`、`VALUES`、`DESC`、`DESCRIBE` 等）及只读 CTE（`WITH ... SELECT`）。底层通过事务级只读保障。
- `write`：允许查询、DML（`INSERT`、`UPDATE`、`DELETE`、`REPLACE INTO`、`MERGE INTO`）和非破坏性结构变更（`CREATE TABLE`、`ALTER TABLE` 等）；严格拦截破坏性 DDL（`DROP`、`TRUNCATE`）和系统用户管理。
- `admin`：允许任意单条合法 SQL 语句，包含 `DROP TABLE/DATABASE`、`TRUNCATE`、`GRANT`、`REVOKE`、角色和权限管理。

> 数据库账号本身必须拥有对应的数据库权限。MCP 的 SQL 策略是应用防御层，生产环境请搭配最小权限账号使用。

## 多模式与方言支持

人大金仓 KingbaseES 支持多种兼容模式（Oracle 兼容模式、MySQL 兼容模式、PostgreSQL 模式）。

MCP Server 采用极简透明设计：
1. `kingbase_get_server_info` 工具会自动查询并返回 `database_mode` 字段（如 `oracle`、`mysql`、`pg`）。
2. AI 大模型在获取数据库版本和模式后，会自动根据目标方言编写对应的 SQL（如 Oracle 模式下的分页 `ROWNUM` / `FETCH FIRST`、MySQL 模式下的反引号和 `LIMIT` 等）。
3. SQL 检查器兼容各模式下的注释语法（`--`、`/* */`、`#`）及标识符引用（`"column"`、`` `column` ``）。

## 环境变量与配置项

| 参数 / 环境变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `--mode` / `KINGBASE_MODE` | 运行安全模式 (`readonly`, `write`, `admin`) | `readonly` |
| `--host` / `KINGBASE_HOST` | KingbaseES 主机地址 | `127.0.0.1` |
| `--port` / `KINGBASE_PORT` | KingbaseES 服务端口 | `54321` |
| `--user`, `-u` / `KINGBASE_USER` | 数据库登录用户名 | `system` |
| `--password`, `-p` / `KINGBASE_PASSWORD` | 数据库登录密码 (也支持 `KINGBASE_PASSWORD_FILE`) | 无 |
| `--database`, `-d` / `KINGBASE_DATABASE` | 默认连接数据库 | `TEST` |
| `--schema` / `KINGBASE_SCHEMA` | 默认 Schema 搜索路径 | 默认使用系统搜索路径 |
| `--ssl` / `KINGBASE_SSL` | 是否开启 SSL | `false` |
| `--ssl-ca` / `KINGBASE_SSL_CA` | CA 证书文件路径 | 无 |
| `--connection-string` / `KINGBASE_CONNECTION_STRING` | 完整连接串 | 无 |
| `KINGBASE_MAX_ROWS` | 单次查询最大返回行数 | `500` |
| `KINGBASE_MAX_RESULT_BYTES` | 单次查询最大返回字节数 | `1048576` (1MB) |
| `KINGBASE_QUERY_TIMEOUT_MS` | 查询超时时间 (毫秒) | `10000` (10s) |
| `KINGBASE_CONNECT_TIMEOUT_MS` | 连接握手超时时间 (毫秒) | `10000` (10s) |
| `KINGBASE_MAX_AFFECTED_ROWS` | 非 admin 模式下 DML 最大允许影响行数 | `1000` |

## 工具列表

- `kingbase_query`：执行一条 SQL 语句，支持 `$1, $2` 绑定变量。受模式保护及影响行数限制。
- `kingbase_get_server_info`：获取数据库版本号、当前兼容模式（`database_mode`：`oracle` / `mysql` / `pg`）、当前用户、当前数据库名与默认 Schema。
- `kingbase_list_databases`：列出当前实例中所有非模板数据库及其大小。
- `kingbase_list_schemas`：列出当前数据库中的命名空间（Schema）。
- `kingbase_list_tables`：列出指定 Schema 下的所有表和视图。
- `kingbase_describe_table`：获取指定表的列结构、数据类型、主键、外键约束定义及索引信息。
