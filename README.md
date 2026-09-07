<p align="center"><img src="assets/logo.svg" width="96" height="96" alt="Pulse Logo"></p>

# Pulse · 月流量与简约面板

基于 [xhhcn/Pulse](https://github.com/xhhcn/Pulse) 的二次开发版本，由 [aoomee/Pulse](https://github.com/aoomee/Pulse) 独立维护。保留上游监控功能，增加可选 vnStat 月流量与精简对齐的前端。

[English](README_EN.md) · [下载测试版](https://github.com/aoomee/Pulse/releases/tag/v1.4.0-vnstat.2) · [容器镜像](https://github.com/aoomee/Pulse/pkgs/container/pulse) · [构建检查](https://github.com/aoomee/Pulse/actions/workflows/publish-fork.yml) · [MIT](LICENSE)

## 当前版本

`v1.4.0-vnstat.2` 是已发布的 **Pre-release 测试版**。镜像支持 Linux amd64 / arm64，公开拉取，无需登录 GHCR。

```text
ghcr.io/aoomee/pulse:1.4.0-vnstat.2
```

请使用这个完整版本号，不要使用上游的 `xhh1128/pulse`，也不要替换成 `latest`。本仓库 `main` 包含新版源码；部署使用已发布版本，不需要自行切换开发分支。

已通过前端构建、Go 测试 / vet、服务端竞态检查、页面布局与动效回归，以及已发布 amd64 容器的启动、健康和页面检查。arm64 镜像已构建；不同 VPS 的安装环境、真实网卡和 vnStat 长期统计仍需实机验证，不代表没有任何缺陷。

## 本版改动

- 修复 Linux 安装命令复制无反应：增加可手动复制的命令框、root / sudo 选择及 HTTP 页面复制兼容处理。
- 修复新主机尚无系统信息时，名称与左侧编辑图标不在同一水平线的问题。
- 可选 vnStat 月流量模式，支持每月 1–28 日切换账期；没有可用 vnStat 数据时保留网卡累计统计。
- 每台机器可配置月额度，进度条内直接显示 `500 GB / 1 TB`，不单独显示百分比。
- 未启用月流量模式时，只显示累计流量数值，没有进度条或“总”字标记。
- 服务列表居中对齐、统一进度条，移除首页系统列；窄屏自动重排，不要求横向滚动。
- 一次性轻柔入场，实时更新不重复展开；修复长名称与复制按钮重叠。

## 快速部署（Docker）

### 1. 确认 Docker 已安装

下面 Linux 新部署命令按 **root 用户**编写，不需要 `sudo`。非 root 用户须使用有权限的账号或按需加 `sudo`。只复制代码块内容，逐条执行，不要复制 `root@…#`、`>` 或“复制”按钮文字。

```bash
docker --version
docker compose version
```

如果提示 `docker: command not found`，先按你的发行版安装 [Docker Engine](https://docs.docker.com/engine/install/) 和 [Compose 插件](https://docs.docker.com/compose/install/)，再继续。包名随系统版本不同，不要把同一条 apt 命令套用到所有机器。已有旧版 `docker-compose` 的环境可将下文 `docker compose` 替换为 `docker-compose`；新安装优先使用插件。

### 2. 新机器部署

在没有同名容器和旧部署的机器上执行。`mkdir` 报目录已存在时先检查目录，不要覆盖原 Compose 文件。

```bash
mkdir pulse
cd pulse
curl -fL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/docker-compose.yaml -o docker-compose.yaml
docker compose pull
docker compose up -d
docker compose ps
```

访问 `http://服务器IP:8008`；管理入口为 `/admin`，首次访问设置管理员密码。若页面无法访问，检查 VPS 安全组 / 防火墙是否允许 TCP 8008。正式对公网使用时建议配置 HTTPS 反向代理。

```bash
docker compose logs --tail=100
curl -fsS http://127.0.0.1:8008/healthz
```

### 3. 已有部署升级

先在管理后台下载备份。在**原部署目录**中，只修改现有 Compose 的 `image` 为上面的版本，保留原端口、容器名、Compose 项目名和映射到 `/app/data` 的数据卷 / 目录，再执行：

```bash
docker compose pull
docker compose up -d
```

**不要执行 `docker compose down -v`，不要为了升级换一个空数据卷。** 默认 Compose 使用命名卷 `pulse-data`，实际卷名带项目名前缀，换目录可能连接到另一份空数据。回滚时先备份当前数据，再切回旧镜像；不要在运行时直接覆盖数据库。

## 月流量怎么启用

1. 在 `/admin` 添加机器，点击对应机器右侧的 Linux 图标。
2. 开启“使用 vnStat 统计月流量”，填写重置日（1–28），按需指定网卡。
3. 在命令框右上角选择 `root` 或 `sudo`（默认 root），点击“复制命令”并在被监控机器执行。也可直接选中框内命令手动复制。
4. 在“编辑服务”中设置月额度（GB / TB）；例如填 `1 TB`，累计到 `500 GB` 时填充一半。

月流量按 **下载 + 上传合计**，额度用十进制单位（1 TB = 1000 GB）。留空或填 0 时不显示额度进度条。实时网速仍取自网卡，不受 vnStat 模式影响。

vnStat 只统计其开始采集后的流量，不能补回安装前的用量。账期按被监控机器本地时区切换，数据落库可能稍有延迟。修改重置日不会重新计算历史数据；安装脚本会修改 `/etc/vnstat.conf` 的 `MonthRotate`，也会影响同机其他 vnStat 使用者。Windows / macOS 保留原统计方式。

后台命令和客户端自动更新固定到本版 Release，避免回退到上游旧程序；未来升级客户端需使用新版安装脚本。

## 独立二进制部署（不使用 Docker）

适用于 Linux amd64 / arm64、systemd 环境，需要 `curl`、`wget`。新安装以 root 执行：

```bash
curl -fL https://raw.githubusercontent.com/aoomee/Pulse/main/install-pulse-server.sh -o install-pulse-server.sh
bash install-pulse-server.sh
```

安装器默认使用本 fork 的 `v1.4.0-vnstat.2`，程序位于 `/opt/pulse/pulse-server`，数据位于 `/opt/pulse/data`，端口 8008。不要与同端口的 Docker 部署同时运行。已有安装升级前先备份，并停止 `pulse-server` 服务后再运行安装器。

```bash
systemctl status pulse-server
journalctl -u pulse-server -n 100
```

手动下载请到 [Release](https://github.com/aoomee/Pulse/releases/tag/v1.4.0-vnstat.2) 选择 `pulse-server-standalone-linux-amd64` 或 `pulse-server-standalone-linux-arm64`。Release 同时提供客户端、安装脚本和 `SHA256SUMS`。

---

## 🌐 Docker IPv6 配置

Pulse 支持 IPv4/IPv6 双栈，如果您的服务器需要 IPv6 支持，请按照以下步骤配置：

### 前置要求

1. **确保宿主机已启用 IPv6**
   ```bash
   # 检查 IPv6 是否启用
   ip -6 addr show
   
   # 检查 IPv6 转发是否启用
   sysctl net.ipv6.conf.all.forwarding
   # 如果输出为 0，需要启用：
   sudo sysctl -w net.ipv6.conf.all.forwarding=1
   
   # 永久启用（编辑 /etc/sysctl.conf）
   echo "net.ipv6.conf.all.forwarding=1" | sudo tee -a /etc/sysctl.conf
   ```

2. **配置 Docker Daemon 启用 IPv6**

   编辑或创建 `/etc/docker/daemon.json`：
   ```json
   {
     "ipv6": true,
     "fixed-cidr-v6": "fd00:dead:beef:c0::/80",
     "experimental": true,
     "ip6tables": true
   }
   ```
   
   > **说明**：
   > - `ipv6: true` - 全局启用 Docker 的 IPv6 支持（**必需**）
   > - `fixed-cidr-v6` - Docker 使用的 IPv6 子网范围（可根据实际情况调整）
   > - `experimental: true` - 启用实验性功能（某些 IPv6 功能需要）
   > - `ip6tables: true` - 启用 IPv6 的 iptables 支持（用于网络隔离和端口映射）
   
   重启 Docker 服务使配置生效：
   ```bash
   sudo systemctl restart docker
   ```

3. **配置 docker-compose.yaml 启用 IPv6**

   在 `docker-compose.yaml` 中配置网络启用 IPv6：
   ```yaml
   services:
     pulse:
       image: ghcr.io/aoomee/pulse:1.4.0-vnstat.2
       container_name: pulse-monitor
       ports:
         - 8008:8008
       volumes:
         - pulse-data:/app/data
       restart: unless-stopped
       networks:
         - pulse-network

   volumes:
     pulse-data:

   networks:
     pulse-network:
       enable_ipv6: true
       ipam:
         driver: default
   ```

4. **重新创建容器**

   ```bash
   docker compose down
   docker compose up -d
   ```

5. **验证 IPv6 配置**

   ```bash
   # 检查容器 IPv6 地址
   docker exec pulse-monitor ip -6 addr show
   
   # 测试 IPv6 连接（如果容器有 ping6）
   docker exec pulse-monitor ping6 -c 2 2001:4860:4860::8888
   ```

---

## 📦 客户端安装

### Linux

以下以 root 执行，请先把 `YOUR_ID`、`SERVER_URL`、`YOUR_SECRET` 替换为后台提供的值。优先使用后台为该机器生成的命令，避免密钥或 ID 填错。

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/install.sh | bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET'
```

Linux 客户端可选用 vnStat 统计当前月或当前账期流量。管理后台点击机器右侧的 Linux 图标，开启“使用 vnStat 统计月流量”后即可生成对应命令；也可以手动安装：

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/install.sh | bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET' --vnstat --traffic-reset-day 8
```

- `--traffic-reset-day` 可设为 `1`–`28`，按被监控机器的本地时区切换账期。
- `--vnstat-interface` 可省略，安装脚本会优先自动识别默认路由网卡。
- vnStat 会由脚本按当前 Linux 发行版安装并作为可选数据源；若安装失败、数据库尚未就绪或读取异常，客户端会自动回退到 Pulse 原有的网卡累计流量。Windows 和 macOS 保持原统计方式。
- 可在管理后台的“编辑服务”中为每台 vnStat 机器设置月流量额度（GB/TB）。首页会按下载与上传合计显示占比进度条；额度采用运营商常用的十进制单位（1 TB = 1000 GB）。留空或填 0 时仅显示本月已用流量。

### macOS（Intel / Apple Silicon）

安装脚本会自动检测 CPU 架构，并将服务注册为 `launchd` 守护进程（开机自动启动）：

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/install.sh | sudo bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET'
```

> **注意**：macOS 需要 `sudo` 权限以便将 `.plist` 写入 `/Library/LaunchDaemons/`。

**macOS 服务管理命令：**

```bash
# 查看运行状态
sudo launchctl print system/com.pulse.client

# 查看日志
tail -f /var/log/pulse-client.log

# 重启服务（推荐方式）
sudo launchctl kickstart -k system/com.pulse.client

# 停止服务
sudo launchctl bootout system/com.pulse.client

# 重新启动已停止的服务
sudo launchctl bootstrap system /Library/LaunchDaemons/com.pulse.client.plist
```

### Windows (管理员 PowerShell)

```powershell
$env:AgentId = 'YOUR_ID'
$env:ServerBase = 'SERVER_URL'
$env:Secret = 'YOUR_SECRET'
irm https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/install.ps1 | iex
```

| 参数 | 说明 |
|------|------|
| `<ID>` | 服务器唯一标识（在管理后台添加系统时设置） |
| `<SERVER_URL>` | 服务端地址，如 `http://your-server:8008` |
| `<SECRET>` | 认证密钥（在管理后台添加系统后自动生成，可在系统详情中查看） |

> **注意**：`--secret` 参数是可选的。如果服务端系统配置了 secret，则必须提供正确的 secret 才能成功注册。

### 卸载客户端

> 客户端默认开启自动更新，因此 systemd 上除了 `pulse-client.service` 还有 `pulse-client-update.service` + `pulse-client-update.timer` 两件，macOS 上则多一个 `com.pulse.client.update` 守护进程。下面的命令同时清理这些组件，无论之前是否启用过自动更新都能安全运行（缺失的 unit 会被忽略）。

**Linux (systemd):**
```bash
sudo systemctl stop pulse-client pulse-client-update.timer 2>/dev/null
sudo systemctl disable pulse-client pulse-client-update.timer 2>/dev/null
sudo rm -f /opt/pulse/probe-client /opt/pulse/update.sh \
  /etc/systemd/system/pulse-client.service \
  /etc/systemd/system/pulse-client-update.service \
  /etc/systemd/system/pulse-client-update.timer
sudo systemctl daemon-reload
```
> 同一台机器若同时跑了服务端，请保留 `/opt/pulse/`（仅删上面列出的客户端相关文件即可），数据库不受影响。

**macOS（含自动更新）:**
```bash
sudo launchctl bootout system/com.pulse.client 2>/dev/null || true
sudo launchctl bootout system/com.pulse.client.update 2>/dev/null || true
sudo rm -rf /opt/pulse \
  /Library/LaunchDaemons/com.pulse.client.plist \
  /Library/LaunchDaemons/com.pulse.client.update.plist
```

**Windows (管理员 PowerShell):**
```powershell
Stop-ScheduledTask -TaskName 'PulseClient' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PulseClient' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Pulse Monitoring Client*' -ErrorAction SilentlyContinue; Remove-Item -Path "$env:ProgramFiles\Pulse" -Recurse -Force -ErrorAction SilentlyContinue
```

---

## ⚙️ 使用方法

1. 访问 `http://YOUR_IP:8008/admin` 进入管理后台
2. 首次访问设置管理密码
3. 点击 **Add System** 添加服务器
4. 添加系统后，系统会自动生成一个 **Secret**（认证密钥）
5. 在目标机器上运行客户端安装命令，**必须包含正确的 Secret**
6. 数据自动上报，实时显示

> **提示**：在管理后台的系统列表中，点击系统右侧的复制按钮可以快速复制包含 Secret 的安装命令。

---

## 📊 监控指标

| 指标 | 内容 |
|------|------|
| **CPU** | 使用率、核心数、型号 |
| **内存** | 使用率、总量 |
| **磁盘** | 使用率、总量 |
| **网络** | 上传/下载速率、TCPing延迟 |
| **系统** | 运行时间、IP、位置 |

---

## 🎨 二次开发 / 自定义主题

Pulse 的前端是独立的 Astro 项目。纯样式、布局和已有数据的展示可在 `server/web/` 中修改；增加新统计能力则可能需要同步改客户端和 Go API。本 fork 的 vnStat 月流量就同时涉及采集、上报和前端展示，并非仅靠主题计算。

### 主题代码在哪里

```
server/web/
├── src/
│   ├── pages/                    # 三个入口路由
│   │   ├── index.astro           #   /        公开仪表盘
│   │   ├── admin.astro           #   /admin   管理面板
│   │   └── login.astro           #   /login   登录页
│   ├── components/               # 9 个可复用组件，全部 Astro + Tailwind
│   │   ├── SystemTable.astro     #     主表 + TCPing 折线图
│   │   ├── AdminDashboard.astro  #     管理面板表格 + 模态框
│   │   ├── NavBar.astro / Footer.astro / LoadingState.astro
│   │   ├── LoginForm.astro / Icon.astro
│   │   └── SystemTableHeader.astro / SystemTableHeaderRow.astro
│   ├── styles/global.css         # 全局动画 + 自定义 Tailwind 工具
│   └── utils/i18n.ts             # 中英文词条（48 条）；新增语言只需扩展 Language 类型
├── tailwind.config.mjs           # 颜色调色板 + dark mode
└── astro.config.mjs              # Astro / Vite 配置（含 dev 代理，下面会讲）
```

### 本地开发工作流

```bash
git clone https://github.com/aoomee/Pulse.git
cd Pulse/server

# 首次启动前生成 Go embed 所需的前端文件（需要 Go 1.22+、Node.js 和 npm）
cd web
npm ci
npm run build
cd ..

# 终端 1：跑后端（监听 :8080）
go run .

# 终端 2：从仓库根目录进入前端（监听 :4321，自动热重载）
cd server/web
npm run dev
```

打开 `http://localhost:4321` 即可看到带热重载的页面。`astro.config.mjs` 已经把 `/api/*` 与 `/healthz` 代理到 `:8080`，**不用改任何 fetch 代码**。如果想对接远程后端（例如自己 VPS 上的实例）：

```bash
PULSE_API_BASE=https://your-pulse-instance.example.com npm run dev
```

### 出包 & 部署

可以从源码构建独立程序或 Docker 镜像。交叉编译产物需在对应平台运行：

**A. 独立二进制（先打前端，再编 Go）：**

```bash
# 1) 前端打包（产出 server/web/dist/）
cd server/web && npm run build

# 2) Go 编译，前端通过 embed.FS 嵌进去；交叉编译只需要换 GOOS/GOARCH
cd ..    # 回到 server/
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o pulse-server .

# 3) 直接跑（数据库写到 ./data/metrics.db）
./pulse-server
```

> 前端必须先 `npm run build`：`go:embed all:web/dist` 是**编译期**指令，build 时没有 `dist/` 目录就会报错。

**B. Docker 镜像（一条命令搞定，前端打包发生在镜像内）：**

```bash
docker build -t my-pulse:dev .
docker run --rm -p 8008:8008 -v "$(pwd)/data:/app/data" my-pulse:dev
```

`Dockerfile` 多阶段构建会替你跑 `npm ci && npm run build`，再把 dist/ 喂给 nginx，Go 后端只走 API。本地改完主题，直接 `docker build` 一遍就好，不需要先单独 `npm run build`。

### 不需要碰的部分

* `server/main.go` & `server/store.go`：后端 API、鉴权、bbolt 存储；只调整主题外观时一般无需修改。
* `client/`：跑在被监控机器上的 Go agent 代码。
* `scripts/`、`install-pulse-server.sh`、`docker/`：部署 / 运维相关。

### 上游协作

只是换皮的话保留独立 fork 就好。如果你做出来的功能有普适价值（一个新组件、一个新过滤器、一个 bug 修复），欢迎提 PR 回主仓库。

---

## 🚚 迁移到另一台服务器

Pulse 服务端的全部状态（系统列表、共享密钥、TCPing 历史、管理员密码、面板配置……）都只保存在 **一个 bbolt 文件** 里。仓库提供的 `scripts/migrate.sh` 把整个流程打包成 **一条命令**：在新服务器上跑一次，就能从旧服务器把所有数据搬过来，旧服务器在备份期间无需停机；迁移的是快照时刻的数据，之后的新写入不会自动同步。

> 客户端 `AGENT_ID` / `SECRET` 保持不变，只有 `SERVER_BASE`（服务端地址）可能需要改。  
> 如果旧端用的是域名 + 反代，只需把 DNS 切到新 IP 即可，客户端完全不用动。

### ✨ 一条命令完成迁移

```bash
# ── 在新服务器上 ──

# 1) 安装 Pulse（二选一）
#    A. 独立二进制（systemd） — 推荐，资源占用最小
#       安装器会顺便把 backup/restore/migrate 脚本装到 /opt/pulse/scripts/
#       并创建 pulse-migrate / pulse-backup / pulse-restore 三个命令。
curl -fsSL https://raw.githubusercontent.com/aoomee/Pulse/main/install-pulse-server.sh | sudo bash

#    B. Docker Compose
# mkdir pulse && cd pulse && \
# curl -sSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.2/docker-compose.yaml -o docker-compose.yaml && \
# docker compose up -d && \
# curl -fsSL https://raw.githubusercontent.com/aoomee/Pulse/v1.4.0-vnstat.2/scripts/migrate.sh -o migrate.sh && chmod +x migrate.sh
#       migrate.sh 会自动从仓库拉取它所依赖的 backup.sh / restore.sh，一个文件够用

# 2) 一条命令迁移 —— 交互式输入旧服务器的管理员密码
sudo pulse-migrate --from https://OLD_HOST                 # 二进制方式（最便捷）
# 或在 Docker 目录里：
# sudo ./migrate.sh --from https://OLD_HOST

# 非交互（CI/自动化，推荐用 env var 避免密码进 `ps`）：
# sudo PASSWORD='旧服务器密码' pulse-migrate --from https://OLD_HOST -y
```

`migrate.sh` 按顺序完成：

1. 用你提供的密码登录 **旧服务器**，换取一次性管理员令牌（密码通过 stdin 传给 `curl`，不会出现在 `ps` 里）。
2. 调用 `GET /api/admin/backup` 拉一份 **事务级一致性** 的热备份——基于 bbolt 的 `Tx.WriteTo`，不会捕获到半写入页，**旧服务器不停机**。
3. 校验下载文件：大小 + bbolt 魔数 `0xEDDA0CED`，避免 `scp` 断流或误传成 `.gz` 直接使用。
4. 自动识别新服务器是 **Docker** 还是 **独立二进制**，停服 → 把当前 `metrics.db` 另存为 `metrics.db.pre-restore-<时间戳>`（一条命令回滚）→ 放入新文件 → 重启服务。
5. 轮询 `/healthz` 直到返回 200，或 60 秒超时后打印日志并给出回滚命令。

默认把下载的备份文件放在权限 `0700` 的私有临时目录，文件本身 `0600`，成功后自动清理；加 `--keep-backup ./pulse-backup.db` 可以保留一份做离线归档。

### 💾 只想手动备份？管理面板一键下载

进 `/admin` 登录后，表头右上角多了一个 **下载备份** 按钮（下载图标，绿色悬停色）。点一下浏览器就会保存一个 `pulse-backup-<UTC 时间戳>.db` —— 跟 `pulse-backup` / `migrate.sh` 拉到的**完全是同一个文件**（事务级一致热快照，基于 `Tx.WriteTo`），可以直接喂给 `sudo pulse-restore <文件>` 在任意新机器上还原。适合：没 SSH 环境、想快速做一次性备份、或者给迁移留个保险。

### 🔐 安全要点（认真看一眼，30 秒）

- **用 HTTPS 或 SSH 隧道**。备份里带着管理员密码哈希 + 每台机器的共享密钥，纯 HTTP 走公网等于把钥匙挂外面。脚本会在检测到非本地 `http://` 时弹出提醒。没有 HTTPS 时推荐：
  ```bash
  ssh -fN -L 8008:localhost:8008 user@OLD_HOST
  sudo pulse-migrate --from http://localhost:8008
  ```
- **别用 `--password '明文'`**。命令行参数在 `ps` 里所有本机用户都看得到。优先：交互式提示（无参数）或环境变量 `PASSWORD='...' pulse-migrate ...`。
- **备份文件 = 生产 DB**。保存时用 `0600` 权限（脚本已做），传输时走加密通道，不用了就删。
- **服务端已经做了多层防护**：登录 5 次失败锁 IP 15 分钟、密码 bcrypt、`/api/admin/backup` 只认 `Authorization: Bearer`（拒绝 `?token=` query，避免令牌进 nginx 日志）、每次备份都会写一条审计日志（包含客户端 IP）。

### 🔁 客户端地址更新（仅当 URL 变了）

```bash
# Linux（systemd 客户端）
sudo sed -i 's#http://OLD_HOST:8008#http://NEW_HOST:8008#g' \
  /etc/systemd/system/pulse-client.service
sudo systemctl daemon-reload && sudo systemctl restart pulse-client
```

### 🛡️ 回滚

旧的 `metrics.db` 在迁移时被自动备份为 `metrics.db.pre-restore-<时间戳>`，随时可以回滚：

```bash
# 独立二进制
sudo systemctl stop pulse-server
sudo cp /opt/pulse/data/metrics.db.pre-restore-* /opt/pulse/data/metrics.db
sudo systemctl start pulse-server

# Docker
docker compose stop
cp datatz/metrics.db.pre-restore-* datatz/metrics.db
docker compose up -d
```

在 `/admin` 登录正常、系统列表齐全、TCPing 图表渲染正常后，再删除这些 `.pre-restore-*` 文件即可。

### 📅 顺便：周期性备份

同一套脚本可以挂到 cron 做日常热备（零停机）：

```bash
# 每天 UTC 03:00 一次，环境变量传密码避免 ps 泄漏
0 3 * * * PASSWORD='YourAdminPW' /opt/pulse/scripts/backup.sh \
  --server http://127.0.0.1:8008 \
  --output /var/backups/pulse/pulse-$(date -u +\%Y\%m\%d).db
```

### ⚠️ 注意事项

- **备份文件等同于全部密钥**：里面包含所有系统的共享密钥和管理员密码哈希，和生产 DB 一样谨慎对待（文件权限、传输通道）。
- **不要同时运行两台服务端指向同一套客户端**——客户端会上报给最先通的那台，数据会分裂。迁移完成后及时下线旧端。
- **脚本参数全览**：`pulse-migrate --help`、`pulse-backup --help`、`pulse-restore --help`（或直接 `/opt/pulse/scripts/*.sh --help`）。

---

## ✨ 新特征

- 私有化模式
- Logo和名称自定义
- CPU类型检测
- 客户端一键部署

---

## 📄 License

[MIT](LICENSE)
