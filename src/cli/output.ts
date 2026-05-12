export function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function writeError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}
