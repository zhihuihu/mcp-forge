# @huzhihui_c/mcp-api

一个基于 OpenAPI / Swagger 规范的动态 REST API 网关 MCP Server。通过统一网关探索体系（Progressive Gateway Pattern），将外部 HTTP/REST API 转化为大模型（LLM）可理解、可探索、可安全调用的 MCP 工具集。

---

## 特性亮点

- **全格式与全版本兼容**：无缝支持 **Swagger 2.0** 与 **OpenAPI 3.0 / 3.1**；原生解析 **JSON**、**YAML**、**YML**；
- **双源加载**：支持**远程 HTTP/HTTPS URL**（如 `http://localhost:8080/v3/api-docs`）与**本地文件**（如 `./openapi.yaml`）；
- **统一网关架构（Gateway Pattern）**：固定对外暴露 4 个标准元工具，彻底杜绝 100+ 个接口灌入大模型导致 Context Window 爆炸、截断与幻觉；
- **基准地址自由定制**：支持 `--base-url` 覆盖实际调用地址，严格锚定 Base URL 提供防 SSRF 安全屏障；
- **灵活认证注入**：支持配置默认全局请求头（`Authorization: Bearer <token>`、`X-API-Key`、Cookie、租户头等）；
- **响应平滑截断**：超大响应（默认 > 1MB）采用自适应平滑截断，保障 LLM 客户端顺畅稳定。

---

## 接入与使用指南

### 1. CLI 命令行一键接入（Claude Code / Codex）

#### 🔹 Claude Code
在终端中执行以下命令，即可将目标 API 挂载至 Claude Code 会话：
```bash
# 挂载在线 OpenAPI/Swagger 文档
claude mcp add my-api -- npx -y @huzhihui_c/mcp-api --spec=https://api.example.com/v3/api-docs --base-url=https://api.example.com --auth-token=YOUR_TOKEN

# 挂载本地 YAML/JSON 规范文档
claude mcp add local-api -- npx -y @huzhihui_c/mcp-api --spec=./api-spec.yaml --base-url=http://localhost:8080
```

#### 🔹 Codex CLI
在终端中执行以下命令，即可自动写入 `~/.codex/config.toml`：
```bash
# 命令行一键添加
codex mcp add my-api -- npx -y @huzhihui_c/mcp-api --spec=https://api.example.com/v3/api-docs --base-url=https://api.example.com --auth-token=YOUR_TOKEN
```
也可以手动编辑 `~/.codex/config.toml` 文件配置：
```toml
[mcp_servers.my-api]
command = "npx"
args = [
  "-y",
  "@huzhihui_c/mcp-api",
  "--spec=https://api.example.com/v3/api-docs",
  "--base-url=https://api.example.com",
  "--auth-token=YOUR_TOKEN"
]
```

---

### 2. GUI 客户端配置（Claude Desktop / Cursor / VS Code）

#### 场景 A：使用远程 Swagger 文档与自定义 Base URL
在 `claude_desktop_config.json` 或 Cursor MCP 配置中添加：
```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": [
        "-y",
        "@huzhihui_c/mcp-api",
        "--spec=https://api.example.com/v3/api-docs",
        "--base-url=https://api.example.com"
      ],
      "env": {
        "API_HEADERS": "{\"Authorization\": \"Bearer eyJhbGciOi...\", \"X-Tenant-ID\": \"001\"}"
      }
    }
  }
}
```

#### 场景 B：使用本地 YAML 文档与 API Key 认证
```json
{
  "mcpServers": {
    "local-api": {
      "command": "npx",
      "args": [
        "-y",
        "@huzhihui_c/mcp-api",
        "--spec=/path/to/openapi.yaml",
        "--base-url=https://api.example.com/v1",
        "--api-key=secret-key-123",
        "--api-key-header=X-API-Key"
      ]
    }
  }
}
```

---

### 3. 本地调试与排错

#### 🔹 启动自检与配置校验（Smoke Test）
MCP 遵循基于 `stdio` 的 JSON-RPC 2.0 协议，等待宿主程序交互。在终端直接运行可用于**秒级验证网络连通性与 OpenAPI 规范解析合法性**：
```bash
# 执行后若文档加载失败、404 或解析异常，会立即在终端打印错误并退出；若静默就绪则说明配置完全正确
npx -y @huzhihui_c/mcp-api --spec=https://api.example.com/v3/api-docs --base-url=https://api.example.com
```

#### 🔹 使用 MCP Inspector 可视化调试（人类直接点选调用）
如果你想在无大模型环境下，像 Postman 一样在网页上直观测试与调用工具，可使用官方 Inspector 启动 Web UI：
```bash
npx @modelcontextprotocol/inspector npx -y @huzhihui_c/mcp-api --spec=https://api.example.com/v3/api-docs --base-url=https://api.example.com --auth-token=YOUR_TOKEN
```
浏览器会自动打开图形界面，支持可视化的参数输入、接口调用与响应查看。

---

## 暴露的标准 MCP 工具（4 个）

无论后台文档包含 10 个还是 2000 个接口，MCP Server 始终稳定对外提供以下 4 个标准工具：

1. **`api_get_spec_info`**：获取 API 系统的全局概况
   - **入参**：无入参 `{}`
   - **返回**：`title`, `version`, `description`, `baseUrl`, `totalEndpoints`（总接口数）, `tags`（所有业务分类标签列表）。

2. **`api_list_endpoints`**：浏览、检索与分页查询接口列表
   - **入参（全部可选）**：
     - `search`（string）：按关键词匹配接口路径、operationId、摘要或描述。
     - `tag`（string）：按业务模块标签过滤（如 `user`, `order`）。
     - `method`（string）：按 HTTP 方法过滤（`GET`, `POST`, `PUT`, `DELETE` 等）。
     - `limit`（number）：单次返回最大数量，默认 50，最大 500。
     - `offset`（number）：跳过的条目数，用于翻页，默认 0。
   - **查询所有接口**：直接传入 `{}` 或 `{ limit: 200 }`（不传过滤条件），即可直接列出所有接口，并返回 `totalMatched`（总匹配数）、`hasMore`（是否还有下一页）和精简字段摘要。

3. **`api_get_endpoint_details`**：获取指定接口的完整结构详情
   - **入参**：`operationId`（推荐）或 `path` + `method`。
   - **返回**：路径参数、Query 参数、Header 参数、Request Body 展开 Schema（递归展开 `$ref`）以及各 HTTP 状态码的响应结构。

4. **`api_call`**：真实执行 HTTP 调用调度器
   - **入参**：`operationId` 或 `path` + `method`，配合 `pathParams`, `queryParams`, `headers`, `body` 等。
   - **执行机制**：自动替换路径占位符（`{id}`）、拼接 Query 参数、注入全局默认认证头、发送请求并安全截断超大结果。
   - **附带 cURL 命令**：每次调用（无论成功还是失败）均会在返回的 `curl` 字段或错误提示中附带**可在 Linux/macOS 终端直接粘贴执行的完整 `curl` 命令**，便于在离线服务器、跳板机或运维环境中独立复现。

---

## 环境变量与 CLI 参数配置

| CLI 参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `--spec=<path\|url>` | `API_SPEC` | **必填** | OpenAPI / Swagger 文档地址（URL 或本地路径，支持 `.json`, `.yaml`, `.yml`） |
| `--base-url=<url>` | `API_BASE_URL` | 文档内置 | 目标服务实际 HTTP 调用 Base URL（未提供时回退到 spec 中声明的 server/host） |
| `--headers=<json>` | `API_HEADERS` | `{}` | JSON 格式的默认通用请求头，如 `'{"X-Tenant": "1"}'` |
| `--header="K: V"` | - | - | 单个默认请求头（可重复传入多次） |
| `--auth-token=<tok>` | `API_AUTH_TOKEN` | - | 快捷注入 `Authorization: Bearer <token>` |
| `--api-key=<key>` | `API_KEY` | - | 快捷注入 API Key |
| `--api-key-header=<h>` | `API_KEY_HEADER` | `X-API-Key` | API Key 对应的 Header 名称 |
| `--include-tags=<t>` | `API_INCLUDE_TAGS` | - | 逗号分隔的 Tag 白名单，仅暴露匹配标签的接口 |
| `--exclude-tags=<t>` | `API_EXCLUDE_TAGS` | - | 逗号分隔的 Tag 黑名单，排除指定标签的接口 |
| `--include-operations`| `API_INCLUDE_OPERATIONS`| - | 逗号分隔的 operationId 白名单 |
| `--timeout-ms=<ms>` | `API_TIMEOUT_MS` | `30000` | HTTP 请求超时毫秒数 |
| `--max-bytes=<bytes>` | `API_MAX_RESULT_BYTES` | `1048576` | 最大返回结果字节数（默认 1MB） |
| `-h, --help` | - | - | 显示命令行帮助 |

---

## 许可证

[MIT](./LICENSE)
