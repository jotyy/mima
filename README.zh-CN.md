<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/vauly-logo-dark.svg">
    <img src="brand/svg/vauly-logo.svg" alt="vauly" height="56">
  </picture>
</p>

<p align="center">
  你的密码和 API Key，加密后放在你自己的 Cloudflare 上。<br>
  给小团队和 AI Agent 用的开源、端到端加密密码管理器。
</p>

<p align="center">
  <a href="https://github.com/jotyy/vauly/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jotyy/vauly/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
</p>

<p align="center">
  <a href="https://demo.vauly.app"><strong>在线演示</strong></a> · <a href="https://vauly.app/docs/">文档（英文）</a> · <a href="https://vauly.app/docs/self-hosting/">部署自己的 vauly</a> · <a href="README.md">English</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/items-dark.png">
  <img alt="vauly 里的 Engineering 保险库，打开着一个 AWS 登录项：用户名、隐藏的密码、实时一次性验证码和网址。" src="docs/images/items.png">
</picture>

vauly 适合想把共享的登录、API Key 和笔记放在一处、并且自己掌控的小团队。它部署在你自己的 Cloudflare 账号上（Workers 和 D1），每个条目在浏览器里加密后才保存：服务器永远看不到你的主密码，也看不到任何条目里的内容，连条目名都看不到。

## 功能

- **端到端加密。** 主密码不离开你的设备。服务器只存密文、被包装的密钥和公钥，没有它能读懂的东西。
- **给 AI Agent 和脚本用密钥，但不给它看。** `vauly run` 把条目的值交给一条命令，启动它的 Agent 或脚本看不到这个值；`vauly mcp` 为 Claude Code、Cursor 等编程 Agent 做同样的事；GitHub Action 为 CI 做同样的事。每个条目第一次使用时，要人批准。见 [Agents and scripts](docs/agents.md)。
- **共享保险库。** 每个人有自己的私人保险库；共享保险库逐个开放给成员，每人可以是只能看、能编辑或能管理。把人移出保险库，他就再也打不开它。
- **团队真正会存的东西。** 带一次性验证码（TOTP）和多个网址的登录、API Key、SSH 密钥、安全笔记、支付卡和身份信息，每种都能加自定义字段和加密文件，比如账号或隐藏的 PIN。还有随机密码和口令短语生成器、强度检查。
- **密码健康。** 总览页列出出现在数据泄露里的密码、弱密码、重复使用的密码，以及离开保险库或团队的人曾经能看到、之后没改过的条目。这些都在你的设备上算出来；泄露检查用 Have I Been Pwned，只有密码哈希的前五个字符离开设备。
- **用 Face ID / Touch ID 解锁。** 在设置里为每台设备开启，用设备的生物识别代替主密码，每次最长 14 天。
- **离线可用。** 安装成 App 后，会在设备上保留一份加密副本，没网也能打开条目。
- **分享链接。** 把一个条目通过会过期的链接发给外包或朋友，可以设成只能看一次。内容在你的设备上加密，密钥只在链接里。
- **不容易丢东西。** 删除的条目在“最近删除”里保留 30 天，通知里就能撤销；改过的密码保留在“历史密码”里。
- **活动日志。** 每次显示、复制、分享、导入和备份都有记录，团队知道谁用了什么。
- **从别的软件搬过来，也能随时搬走。** 支持从 1Password、Bitwarden、LastPass、Dashlane、Keeper、NordPass、RoboForm、Proton Pass、KeePass、Enpass、Apple 密码和浏览器导入，一次性验证码、笔记、文件夹、自定义字段都会带过来，文件在你的设备上读取。随时可以下载一份解密后的备份，vauly 和大多数密码管理器都能导入。
- **浏览器扩展。** 列出当前网站保存的条目，一键填充登录表单，登录新网站后提示保存，还能保存和使用 passkey。见 [Browser extension](docs/browser-extension.md)。
- **可以核对的代码。** Web 端构建可复现，`vauly verify <网址>` 可以确认一个实例提供的代码，和它声明的提交构建出来的完全一致。

## 原理

```
主密码 ──Argon2id（64 MiB，3 轮）──▶ 主密钥 ──HKDF──┬─▶ 认证密钥   发给服务器用于登录
                                                    └─▶ 包装密钥   解开你的私钥
你的密钥对（ECDH P-256）  接收别人共享给你的保险库密钥
保险库密钥（AES-256-GCM） 包装保险库里每个条目的密钥
条目密钥（AES-256-GCM）   加密一个条目
```

浏览器、扩展和 CLI 共用 [`packages/crypto`](packages/crypto) 里的同一套实现：WebCrypto，Argon2id 用 libsodium。密钥只在内存里：刷新页面、点“立即锁定”或闲置几分钟就会忘掉。完整设计、服务器能看到和看不到什么、模型的局限，见 [Security](docs/security.md)。

## 部署自己的 vauly

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jotyy/vauly)

vauly 以一个 Worker（网页和 API）加一个 D1 数据库的形式，部署到你自己的 Cloudflare 账号。点上面的按钮，它会把 vauly 复制到你的一个仓库并部署；按提示设置一个 `SETUP_CODE`，然后打开 `/setup?code=你的设置码` 创建工作区。小团队用 Cloudflare 免费套餐就够。Worker 会自己执行数据库迁移，你仓库里的 **Update vauly** 工作流负责升级。

从本机部署、自定义域名、备份和升级，见 [Self-hosting](docs/self-hosting.md) 和 [Updating vauly](docs/updating.md)。

## 本地开发

需要 [Bun](https://bun.sh) 1.3 或更高版本。

```sh
git clone https://github.com/jotyy/vauly.git
cd vauly
bun install
cp apps/server/.env.example apps/server/.env   # 然后设置 BETTER_AUTH_SECRET
cp apps/web/.env.example apps/web/.env
bun run dev
```

打开 <http://localhost:3001>。第一个访问的人创建工作区并成为 owner，其他人用邀请链接加入。`bun run dev` 在本地跑起整套服务（网页 3001 端口、API 3000 端口、本地 D1 数据库），不需要 Cloudflare 账号。

在 macOS 或 Linux 上安装 CLI，用于 `vauly run` 和 `vauly mcp`：

```sh
curl -fsSL https://vauly.app/install.sh | sh
```

它会用发布版本的校验和核对下载的文件。Windows 版本和自行构建的方法见 [Agents and scripts](docs/agents.md#2-install-the-cli)。

## 文档

文档目前只有英文：
- [Self-hosting](docs/self-hosting.md)：部署和配置你的实例
- [Updating vauly](docs/updating.md)：升级，以及每次升级需要你做什么
- [Moving to vauly](docs/import.md)：从其它密码管理器导入
- [Security](docs/security.md)：加密设计和它的局限
- [Browser extension](docs/browser-extension.md)：安装扩展、填充登录
- [Agents and scripts](docs/agents.md)：`vauly run`、`vauly mcp` 和审批
- [vauly, 1Password and Bitwarden](docs/compare.md)：和它们的区别，以及什么时候该选别的
- [Contributing](CONTRIBUTING.md)：搭开发环境、提交改动
- [Changelog](CHANGELOG.md)

## 参与

欢迎提 bug、想法和 pull request。先读 [CONTRIBUTING.md](CONTRIBUTING.md)，并遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。

发现了安全问题？请不要开公开 issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

vauly 是自由软件，使用 [GNU Affero General Public License v3.0](LICENSE)。如果你通过网络把修改过的版本提供给别人使用，必须向他们提供源代码。

口令短语生成器的词表来自 [EFF 大词表](https://www.eff.org/dice)，© Electronic Frontier Foundation，使用 [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/) 许可。
