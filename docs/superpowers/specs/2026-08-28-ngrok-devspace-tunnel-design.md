# DevSpace ngrok 固定域名隧道设计

- 日期：2026-08-28
- 状态：设计已口头批准，等待书面审核

## 背景

本机 DevSpace 正常监听 `127.0.0.1:7676`，未授权的 `POST /mcp`
返回 `401`。原 zrok 隧道无法创建命名或匿名 share，且
`~/.devspace/config.json` 的 `publicBaseUrl` 仍指向旧 zrok 域名。

用户没有自有域名，但接受注册免费 ngrok 账户，并要求公网地址在进程和
机器重启后保持不变。

## 目标

- 使用 ngrok 免费账户分配的固定 HTTPS 开发域名。
- 将该域名稳定转发到 `http://127.0.0.1:7676`。
- 使用 systemd 用户服务自动启动、断线重启。
- 更新 DevSpace `publicBaseUrl`，使 MCP 与 OAuth 元数据使用新域名。
- 验证公网 MCP 仍由 DevSpace OAuth 保护。
- 成功后禁用故障的 zrok 服务，但保留其单元文件，便于人工回退或后续排查。

## 非目标

- 不购买或配置自有域名。
- 不要求可读、可自选的 vanity hostname。
- 不修改 DevSpace 源代码。
- 不继续修复或迁移 zrok 环境。
- 不把 ngrok authtoken 写入仓库、聊天记录或 systemd 单元。

## 方案选择

采用 ngrok 免费固定开发域名。相比 Tailscale Funnel，它不需要系统级网络
守护进程、MagicDNS 或额外访问策略；相比 Cloudflare Quick Tunnel，它的
地址不会随隧道重启而变化。

免费域名由 ngrok 账户自动分配，域名字符串不能自选。本设计接受这一限制。

## 架构

```text
MCP 客户端
    |
    | HTTPS: https://<assigned-domain>.ngrok-free.app/mcp
    v
ngrok 托管边缘
    |
    | HTTP loopback
    v
127.0.0.1:7676
    |
    v
DevSpace MCP + OAuth
```

## 组件与配置

### ngrok 客户端

- 安装位置：`/home/ad/.local/bin/ngrok`。
- 配置位置：使用 ngrok 默认的用户级配置目录。
- authtoken 由用户在自己的终端中执行官方配置命令写入，代理不会接收、
  打印或复制令牌。
- 固定域名从用户的 ngrok 账户读取，并显式写入服务启动参数。

### systemd 用户服务

新增 `~/.config/systemd/user/ngrok-devspace.service`：

- 在网络和 `devspace.service` 之后启动。
- 将固定 ngrok 域名转发到 `127.0.0.1:7676`。
- 日志写入用户 journal。
- 异常退出后自动重启。
- 单元文件不包含 authtoken。

### DevSpace

- 用 DevSpace 自带的 `config set publicBaseUrl` 命令设置新 HTTPS origin。
- `publicBaseUrl` 只包含 origin，不附加 `/mcp`。
- 重启 `devspace.service`，让 MCP URL、OAuth issuer、resource metadata、
  host allowlist 与 UI asset URL 一起切换到新域名。
- 不修改现有 Owner OAuth token 或工具权限。

### zrok

- 部署期间保持 `zrok-lbh.service` 停止，避免无意义重试。
- 只有 ngrok 全部验收通过后，才禁用 zrok 的开机自启。
- 不删除 zrok 单元、配置、reserved name 或账户数据。

## 部署顺序

1. 记录现有 DevSpace 配置和两个用户服务状态。
2. 安装并校验 ngrok 客户端版本。
3. 暂停，让用户在本机终端私下完成 ngrok 登录或 authtoken 配置。
4. 获取账户分配的固定开发域名。
5. 创建但暂不启用 `ngrok-devspace.service`。
6. 备份 DevSpace 配置，设置新的 `publicBaseUrl`，重启 DevSpace。
7. 启动 ngrok 服务并执行完整验收。
8. 验收通过后启用 ngrok 开机自启，并禁用 zrok 开机自启。

## 验收

必须同时满足：

- `devspace.service` 与 `ngrok-devspace.service` 均为
  `active (running)`。
- 本地 `GET /healthz` 返回 `200`。
- 本地未授权 `POST /mcp` 返回 `401`。
- 公网 `GET /healthz` 返回 `200`。
- 公网未授权 `POST /mcp` 返回 `401`，而非 ngrok 错误页、
  `404`、`502` 或超时。
- OAuth discovery/resource metadata 中的公开 URL 全部使用新 ngrok origin。
- 重启 ngrok 用户服务后，公网域名不变且上述检查仍通过。
- `zrok-lbh.service` 为 disabled 且未运行。

## 错误处理与回滚

- 安装、认证或固定域名发现失败时，不修改 DevSpace 配置。
- ngrok 启动失败时，保留 journal 证据，不反复更换多个配置。
- 更新 `publicBaseUrl` 后若公网验收失败：
  1. 停止 ngrok 服务；
  2. 恢复备份的 DevSpace 配置；
  3. 重启 DevSpace；
  4. 保持 zrok 停止，避免恢复其失败重试循环。
- 不删除 ngrok 账户域名；回滚只处理本机客户端与服务状态。

## 安全边界

- ngrok authtoken 属于秘密，不进入命令回显、设计文档、Git、systemd 或聊天。
- 固定公网域名不是秘密。
- 隧道只指向 loopback 上的 DevSpace，不暴露其他本机端口。
- DevSpace OAuth 继续作为 MCP 访问控制；验收以未授权请求返回 `401` 为准。
- 任何 OAuth token 轮换均不属于本次变更范围。

## 完成标准

用户获得一个固定的 `https://<assigned-domain>.ngrok-free.app/mcp`，
该地址在服务重启后保持不变，能够完成 DevSpace OAuth/MCP 连接，并由
systemd 用户服务持续维护。
