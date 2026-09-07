# @huzhihui_c/mcp-ssh

一个通过 SSH 在远程主机上执行命令的 MCP Server。

## 启动

```bash
pnpm --filter @huzhihui_c/mcp-ssh build
pnpm --filter @huzhihui_c/mcp-ssh start
```

MCP 客户端通常直接启动 npm 包的 bin：

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@huzhihui_c/mcp-ssh"],
      "env": {
        "MCP_SSH_HOST": "example.com",
        "MCP_SSH_USERNAME": "ubuntu",
        "MCP_SSH_PRIVATE_KEY_PATH": "C:/Users/you/.ssh/id_ed25519",
        "MCP_SSH_HOST_KEY_POLICY": "strict",
        "MCP_SSH_HOST_FINGERPRINT": "SHA256:abc..."
      }
    }
  }
}
```

也可以在每次调用 `ssh_exec` 时传入 `host`、`username`、`password` 或 `privateKey`。调用参数优先于环境变量。

支持的环境变量：

- `MCP_SSH_HOST`：默认主机。
- `MCP_SSH_PORT`：默认端口，默认为 `22`。
- `MCP_SSH_USERNAME`：默认用户名。
- `MCP_SSH_PASSWORD`：密码认证。
- `MCP_SSH_PRIVATE_KEY`：私钥内容。
- `MCP_SSH_PRIVATE_KEY_PATH`：私钥文件路径。
- `MCP_SSH_PASSPHRASE`：私钥口令。
- `MCP_SSH_HOST_KEY_POLICY`：主机密钥校验策略，可选 `strict`、`known_hosts` 或 `disabled`，默认 `disabled`。
- `MCP_SSH_HOST_FINGERPRINT`：`strict` 策略下必填的 OpenSSH SHA256 指纹，例如 `SHA256:abc...`。也可以在工具调用中传入 `hostFingerprint`。
- `MCP_SSH_KNOWN_HOSTS_PATH`：`known_hosts` 策略使用的文件路径，默认是 `~/.ssh/known_hosts`。
- `MCP_SSH_AUTH_SOCK`：SSH Agent socket；未设置时会尝试使用 `SSH_AUTH_SOCK`。

## 工具

### `ssh_exec`

在远程主机上执行命令。必填参数是 `command`；连接参数和主机密钥校验策略可以由调用参数或环境变量提供。

也可以在每次调用中传入 `hostKeyPolicy` 和 `knownHostsPath`：

- `strict`：必须提供 `hostFingerprint`，适合生产环境。
- `known_hosts`：从 `knownHostsPath` 或 `~/.ssh/known_hosts` 校验主机密钥。
- `disabled`：默认策略，不校验主机密钥，使用方便但存在中间人攻击风险。

返回标准输出、标准错误和退出码。默认最多返回 1 MiB 输出，可通过 `maxOutputBytes` 调整，上限为 10 MiB。
