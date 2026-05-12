export function createUnifiedDiff(pathName: string, before: string, after: string): string {
  if (before === after) {
    return `--- ${pathName}\n+++ ${pathName}\n`;
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  if (beforeLines.length * afterLines.length > 250_000) {
    return createWholeFileDiff(pathName, beforeLines, afterLines);
  }

  const operations = diffLines(beforeLines, afterLines);

  return [
    `--- ${pathName}`,
    `+++ ${pathName}`,
    "@@",
    ...operations.map((operation) => `${operation.prefix}${operation.line}`)
  ].join("\n");
}

interface DiffOperation {
  readonly prefix: " " | "+" | "-";
  readonly line: string;
}

function diffLines(before: readonly string[], after: readonly string[]): readonly DiffOperation[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));

  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row]![column] =
        before[row] === after[column]
          ? table[row + 1]![column + 1]! + 1
          : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
    }
  }

  const operations: DiffOperation[] = [];
  let row = 0;
  let column = 0;

  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      operations.push({ prefix: " ", line: before[row] ?? "" });
      row += 1;
      column += 1;
    } else if (table[row + 1]![column]! >= table[row]![column + 1]!) {
      operations.push({ prefix: "-", line: before[row] ?? "" });
      row += 1;
    } else {
      operations.push({ prefix: "+", line: after[column] ?? "" });
      column += 1;
    }
  }

  while (row < before.length) {
    operations.push({ prefix: "-", line: before[row] ?? "" });
    row += 1;
  }

  while (column < after.length) {
    operations.push({ prefix: "+", line: after[column] ?? "" });
    column += 1;
  }

  return operations;
}

function createWholeFileDiff(pathName: string, beforeLines: readonly string[], afterLines: readonly string[]): string {
  return [
    `--- ${pathName}`,
    `+++ ${pathName}`,
    "@@",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join("\n");
}

function splitLines(value: string): string[] {
  const withoutFinalNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split("\n");
}
