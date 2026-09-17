# MCP Forge

一个用于构建和发布 MCP Server 的 pnpm Monorepo。

## 设计约定

- `packages/mcp-*`：每个 MCP 是一个独立 npm package，可以单独构建、启动和发布。
- 根目录：只放工作区配置、TypeScript/Prettier 等共享开发工具，不承载具体 MCP 业务逻辑。
- MCP 服务默认使用标准输入输出（stdio）传输，方便接入 Claude Desktop、Cursor 等 MCP 客户端。

## 当前 MCP

- [`@huzhihui_c/mcp-ssh`](./packages/mcp-ssh)：通过 SSH 在远程主机上执行命令。
- [`@huzhihui_c/mcp-mysql`](./packages/mcp-mysql)：按 `readonly`、`write`、`admin` 三档模式访问 MySQL。
- [`@huzhihui_c/mcp-postgres`](./packages/mcp-postgres)：按 `readonly`、`write`、`admin` 三档模式访问 PostgreSQL。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

只运行 SSH MCP：

```bash
pnpm --filter @huzhihui_c/mcp-ssh dev
```

只运行 MySQL MCP：

```bash
pnpm --filter @huzhihui_c/mcp-mysql dev -- --mode=readonly
```

只运行 PostgreSQL MCP：

```bash
pnpm --filter @huzhihui_c/mcp-postgres dev -- --mode=readonly
```

发布单个 MCP：

```bash
pnpm --filter @huzhihui_c/mcp-ssh build
pnpm --filter @huzhihui_c/mcp-ssh publish --access public

pnpm --filter @huzhihui_c/mcp-mysql build
pnpm --filter @huzhihui_c/mcp-mysql publish --access public

pnpm --filter @huzhihui_c/mcp-postgres build
pnpm --filter @huzhihui_c/mcp-postgres publish --access public
```
