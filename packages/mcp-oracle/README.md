# @huzhihui_c/mcp-oracle

一个适用于 Oracle Database 的 MCP (Model Context Protocol) Server：默认只读模式，显式使用 `--mode=write` 或 `--mode=admin` 才允许写操作或管理操作。

## 特性

- **纯 JavaScript Thin 驱动**：基于官方 `oracledb` 6.x+，默认运行在纯 JS Thin 模式下，**无需安装 Oracle Instant Client 或配置 C++ 编译环境**，跨平台即开即用（支持 Oracle 12.1、12.2、18c、19c、21c、23ai）。
- **智能连接串生成**：同时支持 `--service-name`（适用于现代 CDB/PDB 多租户数据库）与 `--sid`（适用于传统实例），或通过 `--connect-string` 直接指定。
- **全版本元数据兼容**：基于 `ALL_TABLES` 与 `ALL_TAB_COLUMNS`，智能处理表名/列名大小写容错，兼顾普通开发用户与 DBA 权限。
- **三档安全策略**：支持双引号标识符、CTE 通用表表达式、`MERGE` 语句分类，自动剥离尾部多余分号（防止 ORA-00911 无效字符），拦截多语句注入。

## 启动方式

### 1. 命令行直接启动

```bash
# 默认只读模式（连接 PDB）
npx -y @huzhihui_c/mcp-oracle --host=127.0.0.1 --service-name=XEPDB1 -u hr -p welcome1

# 指定 SID
npx -y @huzhihui_c/mcp-oracle --host=127.0.0.1 --sid=ORCL -u system -p manager

# 写模式
npx -y @huzhihui_c/mcp-oracle --mode=write --host=127.0.0.1 --service-name=ORCLPDB1 -u hr -p welcome1

# 管理员模式
npx -y @huzhihui_c/mcp-oracle --mode=admin --connect-string=127.0.0.1:1521/FREEPDB1 -u sys -p syspass
```

### 2. MCP 客户端配置示例

#### Claude Desktop / Cursor / Antigravity 配置

在 `claude_desktop_config.json` 或相应 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "oracle": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-oracle"],
      "env": {
        "ORACLE_HOST": "127.0.0.1",
        "ORACLE_PORT": "1521",
        "ORACLE_SERVICE_NAME": "XEPDB1",
        "ORACLE_USER": "hr",
        "ORACLE_PASSWORD": "welcome1",
        "ORACLE_MODE": "readonly"
      }
    }
  }
}
```

#### Claude Code CLI 直接添加

```bash
claude mcp add oracle npx -y @huzhihui_c/mcp-oracle --env ORACLE_HOST=127.0.0.1 --env ORACLE_PORT=1521 --env ORACLE_SERVICE_NAME=XEPDB1 --env ORACLE_USER=hr --env ORACLE_PASSWORD=welcome1
```

#### Codex CLI 直接添加

```bash
codex mcp add oracle -- npx -y @huzhihui_c/mcp-oracle
```

## 模式说明

- `readonly`（默认模式）：只允许只读语句（`SELECT`、CTE 查询）。拦截所有修改、DDL 与管理命令。
- `write`：允许查询、DML（`INSERT`、`UPDATE`、`DELETE`、`MERGE`）及非破坏性表变更（`CREATE TABLE`、`ALTER TABLE`）；严格禁止破坏性 DDL（`DROP TABLE/VIEW`、`TRUNCATE`、`PURGE`）、权限管理与管理员命令。
- `admin`：允许单条 Oracle 语句，包括破坏性 DDL、`GRANT`、`REVOKE`、`ALTER SYSTEM` 等。

## 工具列表

1. `oracle_query`：执行单条 SQL 语句（支持 `:1`, `:2` 绑定变量），受安全策略与行数/字节保护。
2. `oracle_get_server_info`：返回 Oracle 版本 Banner、当前用户及数据库名称。
3. `oracle_list_tables`：列出表（默认查当前连接用户的所有表，或通过 `schema` 参数指定）。
4. `oracle_describe_table`：查看表字段定义（列名、数据类型、数据长度、精度、默认值、是否可空）。
5. `oracle_list_views`：列出视图清单。

## 参数与环境变量

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `--mode` | `ORACLE_MODE` | `readonly` | 运行模式：`readonly`、`write`、`admin` |
| `--host`, `--server` | `ORACLE_HOST` | `127.0.0.1` | 数据库主机地址 |
| `--port` | `ORACLE_PORT` | `1521` | 数据库端口 |
| `--user`, `-u` | `ORACLE_USER` | 无 | 数据库用户名 |
| `--password`, `-p` | `ORACLE_PASSWORD` | 无 | 数据库密码 |
| `--service-name` | `ORACLE_SERVICE_NAME` | `XE` | 服务名（适用于 PDB） |
| `--sid` | `ORACLE_SID` | 无 | 数据库 SID（适用于传统实例） |
| `--connect-string` | `ORACLE_CONNECT_STRING` | 无 | 直接指定 Easy Connect 或 TNS 连接串 |
| `--schema` | `ORACLE_SCHEMA` | 无 | 默认查看的 Schema |
| `--thick` | `ORACLE_THICK_MODE` | `false` | 启用 Thick 驱动模式 |
| `--oracle-home` | `ORACLE_HOME` | 无 | Oracle Client 运行库目录 |

## 许可证

MIT License
