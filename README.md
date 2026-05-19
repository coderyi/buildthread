# buildthread

一个轻量的 AI 编程命令行工具。

## 环境要求

- Node.js 18 或以上版本
- npm

## 安装

```bash
npm install
npm run build
```

本地使用命令：

```bash
npm link
```

## 配置

推荐通过环境变量配置 API Key：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

也可以在单次执行时通过 `--api-key` 传入。

## 使用

一次性 prompt：

```bash
buildthread "阅读这个项目并给出改进建议"
```

指定工作目录：

```bash
buildthread --cwd ./my-project "优化项目结构"
```

指定模型：

```bash
buildthread --model deepseek-v4-flash "重构 src/index.ts"
```

列出可用 skills：

```bash
buildthread --skills
```

审查未提交改动：

```bash
buildthread review
```

审查相对分支或指定提交的改动：

```bash
buildthread review --base main
buildthread review --commit <sha>
```

启动交互界面：

```bash
buildthread
```

交互界面中可使用 `/skills` 查看 skills，使用 `/skill:<name> <prompt>` 指定 skill，使用 `/review` 进入review流程。

## 参数

```text
--model <name>     指定模型
--cwd <path>       指定工作目录，默认当前目录
--api-key <key>    指定 API Key
--no-stream        关闭流式输出
--skills           列出可用本地 skills
--skill <name>     在一次性 prompt 中使用指定 skill
--help             查看帮助
--version          查看版本
```

## 开发

```bash
npm run build
npm start
```

## 许可证

MIT
