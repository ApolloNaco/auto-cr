# 发布 AutoCR 到插件市场

## 一、VS Code Marketplace（推荐）

### 1. 获取 Personal Access Token (PAT)

1. 打开 [Azure DevOps](https://dev.azure.com)，用**微软账号**登录（与 Marketplace 出版商一致）。
2. 右上角用户头像 → **Personal access tokens** → **+ New Token**。
3. 设置：
   - **Name**：随意，如 `vsce-publish`
   - **Organization**：选 **All accessible organizations** 或你创建出版商的组织
   - **Expiration**：建议 1 年
   - **Scopes**：选 **Custom defined** → 勾选 **Marketplace** → **Manage**
4. 创建后**复制 PAT**（只显示一次）。

### 2. 创建出版商（仅首次）

- 若尚未创建出版商：打开 [Manage publishers](https://marketplace.visualstudio.com/manage/publishers/)，用同一微软账号创建出版商，名称填 `ApolloNaco`（与 `package.json` 中 `publisher` 一致）。

### 3. 登录并发布

在项目目录 `auto-cr` 下执行：

```bash
# 登录（按提示粘贴 PAT）
npx @vscode/vsce login ApolloNaco

# 发布当前版本（package.json 的 version）
npm run publish:marketplace
```

或一行命令用 PAT 直接发布（避免交互）：

```bash
VSCE_PAT=你的PAT npm run publish:marketplace
```

### 4. 更新版本再发布

修改 `package.json` 里的 `version`（如 `1.0.0` → `1.0.1`），然后执行：

```bash
npm run publish:marketplace
```

也可用 vsce 自动升版本并发布：

```bash
npx @vscode/vsce publish patch --no-dependencies   # 1.0.0 → 1.0.1
npx @vscode/vsce publish minor --no-dependencies   # 1.0.0 → 1.1.0
npx @vscode/vsce publish major --no-dependencies   # 1.0.0 → 2.0.0
```

---

## 二、Open VSX（可选）

Cursor 等也可从 Open VSX 安装。首次需创建账号并获取 token：

1. 打开 [Open VSX](https://open-vsx.org)，登录/注册。
2. 进入 [User Settings → Access Tokens](https://open-vsx.org/user-settings/tokens)，创建 token。
3. 发布：

```bash
npx ovsx publish auto-cr-1.0.0.vsix -p 你的OpenVSXToken
```

（需先 `npm run package` 生成 `auto-cr-1.0.0.vsix`。）

---

## 常见问题

- **PAT 验证失败**：确认 PAT 的 Scope 包含 Marketplace → **Manage**，且出版商名称与 `package.json` 的 `publisher` 完全一致（如 `ApolloNaco`）。
- **版本已存在**：在 `package.json` 中提高 `version` 后再执行发布。
