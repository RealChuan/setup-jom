# Setup JOM

![Linter](https://github.com/RealChuan/setup-jom/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/RealChuan/setup-jom/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/RealChuan/setup-jom/actions/workflows/check-dist.yml/badge.svg)
![Coverage](./badges/coverage.svg)

在 GitHub Actions 的 Windows 运行器上安装
[JOM](https://wiki.qt.io/Jom)。JOM 是 Qt 提供的并行 `make`
替代品，在编译 Qt 项目时比 `nmake` 快很多。

## 安装位置

| 平台    | 默认目录 | 可执行文件       |
| ------- | -------- | ---------------- |
| Windows | `C:\jom` | `C:\jom\jom.exe` |
| 其他    | 不安装   | -                |

JOM 只有 Windows 版本。在 Linux 和 macOS 运行器上，Action 会输出一条警告并跳过安装，不会让整个工作流失败，因此可以直接放进
`matrix` 构建。

安装完成后，Action 会：

- 把安装目录加入后续步骤的 `PATH`（可用 `add-to-path: false` 关闭）
- 输出 `jom-path`、`jom-executable`、`jom-version` 和 `jom-skipped`

## 快速开始

```yaml
jobs:
  build:
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v7

      - name: Setup JOM
        uses: RealChuan/setup-jom@main

      - name: Show the installed version
        run: jom /version
```

## 输入参数

| 参数              | 说明                                         | 必需 | 默认值   |
| ----------------- | -------------------------------------------- | ---- | -------- |
| `jom-version`     | `latest` 或完整版本号，例如 `1.1.7`、`1_1_7` | 否   | `latest` |
| `install-dir`     | 安装目录，留空则使用 `C:\jom`                | 否   | `''`     |
| `clean`           | 解压前删除已存在的安装目录                   | 否   | `true`   |
| `verify-checksum` | 用官方 `md5sums.txt` 校验下载的文件          | 否   | `true`   |
| `add-to-path`     | 把安装目录加入后续步骤的 `PATH`              | 否   | `true`   |

## 输出参数

| 参数             | 说明                              |
| ---------------- | --------------------------------- |
| `jom-path`       | JOM 的安装目录，非 Windows 时为空 |
| `jom-executable` | `jom.exe` 的完整路径              |
| `jom-version`    | 安装的 JOM 版本，例如 `1.1.7`     |
| `jom-skipped`    | 是否因为运行器不是 Windows 而跳过 |

## 使用示例

### 固定 JOM 版本

`latest` 会从官方 `md5sums.txt`
里挑出最新的版本号，再下载对应的版本化压缩包。需要可复现的构建时，把版本固定下来，Action会下载对应的
`jom_1_1_7.zip`：

```yaml
- name: Setup JOM
  uses: RealChuan/setup-jom@main
  with:
    jom-version: 1.1.7
```

版本必须是完整的三段式版本号，`1.1` 这种写法会直接报错，避免猜错补丁版本。

### 安装到自定义目录

```yaml
- name: Setup JOM
  id: setup-jom
  uses: RealChuan/setup-jom@main
  with:
    install-dir: ${{ runner.temp }}\jom

- name: Use the installation
  run: echo "${{ steps.setup-jom.outputs.jom-executable }}"
```

相对路径会相对于工作区解析，例如 `install-dir: tools/jom` 会安装到
`${{ github.workspace }}\tools\jom`。

### 矩阵构建

```yaml
strategy:
  matrix:
    os: [windows-latest, ubuntu-latest, macos-latest]

steps:
  - uses: actions/checkout@v7

  - name: Setup JOM
    id: setup-jom
    uses: RealChuan/setup-jom@main

  - if: runner.os == 'Windows'
    run: jom /version
```

非 Windows 运行器上 `jom-skipped` 为 `true`，可以据此决定后续步骤是否执行。

## 说明

- **校验和**：默认下载官方 `md5sums.txt`
  并校验压缩包。校验和文件本身下载失败、或其中没有对应条目时只会警告；哈希不匹配则会失败，说明下载已损坏。
- **`clean`**：默认 `true`，会先删除整个 `install-dir`
  再解压。请给 JOM 一个专用目录，不要在 `install-dir` 里放其他文件。设为 `false`
  时会复用目录，压缩包内容直接覆盖同名文件。
- **`latest` 的含义**：`latest` 不使用官方的 `jom.zip`
  别名，因为该别名在官方服务器上可能滞后（实测 `jom.zip` 的内容仍是 1.1.6，而
  `md5sums.txt` 已标注为 1.1.7，两者哈希不一致）。Action 改为解析 `md5sums.txt`
  中的版本化归档并取最高版本，因此 `jom-version` 输出的是真实版本号，而不是
  `latest`。同一份工作流在官方发布新版本后仍可能拿到不同的 JOM 版本；需要可复现时请固定版本号。
- **不做缓存**：JOM 压缩包约 1.7 MB，从 `download.qt.io`
  下载通常只需要一两秒，缓存收益很小，反而容易留下不完整的安装目录。
- **`PATH` 作用范围**：`core.addPath`
  只影响当前工作流后续的步骤，不会修改运行器的全局环境变量。

## 开发

```bash
npm install        # 安装依赖
npm run all        # 格式化、lint、测试、更新覆盖率徽章、打包 dist/
```

修改 `src/` 后必须重新打包并提交 `dist/index.js`，否则 Action 运行的还是旧代码。

单元测试在 Linux 上也能跑：安装流程通过 `platform` 参数注入平台，纯逻辑放在
`src/jom.ts`，文件和网络操作集中在 `src/install.ts` 并被 mock。

在 Windows 上本地联调可以执行：

```powershell
${env:INPUT_JOM-VERSION} = 'latest'
${env:INPUT_INSTALL-DIR} = "$env:TEMP\jom"
npm run local-action
```

## 许可

[MIT](./LICENSE)
