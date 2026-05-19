export function formatHelp(): string {
  return `Usage:
  buildthread [options] [prompt]
  buildthread [options] review [--uncommitted | --base <branch> | --commit <sha> | custom instructions]

Options:
  --model <name>     Model to use. Default: deepseek-v4-flash
  --cwd <path>       Working directory. Default: current directory
  --api-key <key>    DeepSeek API key. Prefer DEEPSEEK_API_KEY for regular use
  --no-stream        Disable streaming output
  --skills           List available local skills and exit
  --skill <name>     Use a local skill for this prompt-mode request
  --help             Show help
  --version          Show version

Review:
  review             Review uncommitted changes
  review --base main Review changes from merge-base with main to HEAD
  review --commit X  Review one commit
  review <text>      Review uncommitted changes with custom instructions
`;
}
