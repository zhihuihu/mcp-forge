# @huzhihui_c/mcp-mysql

一个参考 AWS Labs MySQL MCP 安全模型实现的 MySQL MCP Server：默认只读，显式使用 `--mode=write` 或 `--mode=admin` 才开启写操作。

## 启动

默认只读：

```bash
pnpm --filter @huzhihui_c/mcp-mysql build
pnpm --filter @huzhihui_c/mcp-mysql start
```

写模式：

```bash
npx -y @huzhihui_c/mcp-mysql --mode=write
```

管理员模式：

```bash
npx -y @huzhihui_c/mcp-mysql --mode=admin
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mcp_readonly",
        "MYSQL_PASSWORD": "runtime-secret",
        "MYSQL_DATABASE": "appdb",
        "MYSQL_SSL": "false"
      }
    }
  }
}
```

## 模式

- `readonly`：默认模式，只允许 `SELECT`、`SHOW`、`DESCRIBE`、`EXPLAIN`。
- `write`：允许查询、DML 和普通 DDL；仍然拒绝账户管理、服务器管理和多语句。
- `admin`：允许单条 MySQL 语句，包括 `GRANT`、`REVOKE`、用户管理和数据库管理语句。数据库账号本身必须拥有对应权限。

不要使用 root 账号作为日常 MCP 账号。MCP 的 SQL 检查只是防御层，真正的安全边界是 MySQL 的最小权限账号。

## 环境变量

- `MYSQL_HOST`：MySQL 主机，默认为 `127.0.0.1`。
- `MYSQL_PORT`：MySQL 端口，默认为 `3306`。
- `MYSQL_USER`：必填，MySQL 用户名。
- `MYSQL_PASSWORD`：密码；也可以使用 `MYSQL_PASSWORD_FILE`。
- `MYSQL_DATABASE`：默认数据库，可选。
- `MYSQL_SSL`：是否启用 TLS，默认 `false`。
- `MYSQL_SSL_CA`：CA 文件路径；启用 TLS 时建议配置。
- `MYSQL_MODE`：`readonly`、`write` 或 `admin`，默认 `readonly`。
- `MYSQL_MAX_ROWS`：最大返回行数，默认为 `500`。
- `MYSQL_MAX_RESULT_BYTES`：最大返回结果字节数，默认为 `1048576`。
- `MYSQL_QUERY_TIMEOUT_MS`：查询超时时间，默认为 `10000`。
- `MYSQL_MAX_AFFECTED_ROWS`：非 admin 模式单次 DML 最大影响行数，默认为 `1000`。

命令行 `--mode` 优先于 `MYSQL_MODE`。`--allow_admin_query` 不受支持；管理员能力由 `--mode=admin` 唯一控制。

## 工具

- `mysql_query`：执行一条 SQL；默认只读。
- `mysql_get_server_info`：获取 MySQL 版本、当前用户和当前数据库。
- `mysql_list_databases`：列出当前账号可见的数据库。
- `mysql_list_tables`：列出指定数据库的表和视图。
- `mysql_describe_table`：查看指定表的列定义。

结果包含 `schema_version`、语句类型、列、行、影响行数等结构化信息；输出默认限制为 500 行和 1 MiB。
