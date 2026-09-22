# @huzhihui_c/mcp-sqlserver

一个适用于 Microsoft SQL Server 的 MCP (Model Context Protocol) Server：默认只读模式，显式使用 `--mode=write` 或 `--mode=admin` 才允许写操作或管理操作。

## 特性

- **100% 纯 JavaScript**：基于 `mssql` / `tedious`，无需任何本地 C++ 编译环境（node-gyp/Python），跨平台即开即用。
- **开箱即用兼容**：默认开启 `trustServerCertificate: true`，避免内网自建实例或开发测试库因未配置可信证书而握手失败。
- **三档安全策略**：内置 T-SQL 词法解析器，支持中括号标识符（如 `[dbo].[users]`）、CTE 通用表表达式及多语句防注入拦截。
- **标准 ANSI 元数据探测**：基于 `INFORMATION_SCHEMA` 与 `sys.databases`，全版本（2008 ~ 2022）稳定通用。

## 启动方式

### 1. 命令行直接启动

```bash
# 默认只读模式
npx -y @huzhihui_c/mcp-sqlserver --host=127.0.0.1 -u sa -p Secret123! -d mydb

# 写模式
npx -y @huzhihui_c/mcp-sqlserver --mode=write --host=127.0.0.1 -u sa -p Secret123! -d mydb

# 管理员模式
npx -y @huzhihui_c/mcp-sqlserver --mode=admin --host=127.0.0.1 -u sa -p Secret123! -d mydb
```

### 2. MCP 客户端配置示例

#### Claude Desktop / Cursor / Antigravity 配置

在 `claude_desktop_config.json` 或相应 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "sqlserver": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-sqlserver"],
      "env": {
        "SQLSERVER_HOST": "127.0.0.1",
        "SQLSERVER_PORT": "1433",
        "SQLSERVER_USER": "sa",
        "SQLSERVER_PASSWORD": "YourPassword123!",
        "SQLSERVER_DATABASE": "mydb",
        "SQLSERVER_MODE": "readonly"
      }
    }
  }
}
```

#### Claude Code CLI 直接添加

```bash
claude mcp add sqlserver npx -y @huzhihui_c/mcp-sqlserver --env SQLSERVER_HOST=127.0.0.1 --env SQLSERVER_PORT=1433 --env SQLSERVER_USER=sa --env SQLSERVER_PASSWORD=Secret --env SQLSERVER_DATABASE=mydb
```

#### Codex CLI 直接添加

```bash
codex mcp add sqlserver -- npx -y @huzhihui_c/mcp-sqlserver
```

## 模式说明

- `readonly`（默认模式）：只允许只读语句（`SELECT`、CTE 只读查询）。拦截所有修改与管理命令。
- `write`：允许查询、DML（`INSERT`、`UPDATE`、`DELETE`、`MERGE`）及非破坏性表变更（`CREATE TABLE`、`ALTER TABLE`）；严格禁止破坏性 DDL（`DROP TABLE/VIEW`、`TRUNCATE`）、`EXEC`、`KILL` 及权限管理。
- `admin`：允许单条 SQL Server 语句，包括破坏性 DDL、`EXEC`、`GRANT`、`REVOKE` 等。

## 工具列表

1. `sqlserver_query`：执行单条 SQL 语句（支持 `@p1`, `@p2` 参数化），受安全策略与行数/字节保护。
2. `sqlserver_get_server_info`：返回 SQL Server 版本号、当前用户、数据库及服务器名称。
3. `sqlserver_list_databases`：列出当前可见的所有在线数据库。
4. `sqlserver_list_schemas`：列出架构（dbo, sys 等）。
5. `sqlserver_list_tables`：列出表和视图（可按 schema 过滤）。
6. `sqlserver_describe_table`：查看指定表字段定义（类型、精度、默认值、是否可空）。

## 参数与环境变量

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `--mode` | `SQLSERVER_MODE` | `readonly` | 运行模式：`readonly`、`write`、`admin` |
| `--host`, `--server` | `SQLSERVER_HOST` | `127.0.0.1` | 数据库主机地址 |
| `--port` | `SQLSERVER_PORT` | `1433` | 数据库端口 |
| `--user`, `-u` | `SQLSERVER_USER` | 无 | 数据库登录名 |
| `--password`, `-p` | `SQLSERVER_PASSWORD` | 无 | 数据库密码 |
| `--database`, `-d` | `SQLSERVER_DATABASE` | 无 | 默认数据库 |
| `--instance-name` | `SQLSERVER_INSTANCE_NAME` | 无 | 命名实例（如 SQLEXPRESS） |
| `--domain` | `SQLSERVER_DOMAIN` | 无 | Windows 域验证 |
| `--encrypt` | `SQLSERVER_ENCRYPT` | `false` | 启用 TLS/SSL 加密 |
| `--trust-server-certificate` | `SQLSERVER_TRUST_SERVER_CERTIFICATE` | `true` | 信任服务端自签名证书 |
| `--connection-string` | `SQLSERVER_CONNECTION_STRING` | 无 | 连接 URL（如 `mssql://user:pass@host:1433/db`） |

## 许可证

MIT License
