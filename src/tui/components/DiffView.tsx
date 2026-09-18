import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";

export type ChangeStatus = "pending" | "applied" | "discarded" | "failed";

interface DiffViewProps {
  readonly diff: string;
  readonly status?: ChangeStatus;
  readonly error?: string;
}

const DEFAULT_TERMINAL_WIDTH = 80;
const APP_HORIZONTAL_PADDING = 2;
const ADDED_LINE_BACKGROUND = "#def4e1";
const REMOVED_LINE_BACKGROUND = "#f8e9e7";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function DiffView({ diff, status = "pending", error }: DiffViewProps): React.ReactElement | null {
  const contentWidth = useContentWidth();

  if (diff.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Proposed changes</Text>
      <Box flexDirection="column">
        {diff.split("\n").map((line, index) => (
          <DiffLine key={index} line={line} width={contentWidth} />
        ))}
      </Box>
      <Text color={statusColor(status)}>{statusText(status, error)}</Text>
    </Box>
  );
}

function DiffLine({ line, width }: { readonly line: string; readonly width: number }): React.ReactElement {
  const backgroundColor = diffLineBackground(line);

  if (backgroundColor === undefined) {
    return <Text>{line}</Text>;
  }

  const lineWidth = displayWidth(line);
  const paddingWidth = (width - (lineWidth % width)) % width;

  return (
    <Text backgroundColor={backgroundColor}>
      {line}
      {" ".repeat(paddingWidth)}
    </Text>
  );
}

function diffLineBackground(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return ADDED_LINE_BACKGROUND;
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return REMOVED_LINE_BACKGROUND;
  }

  return undefined;
}

function useContentWidth(): number {
  const { stdout } = useStdout();
  const readWidth = (): number => Math.max(1, (stdout.columns || DEFAULT_TERMINAL_WIDTH) - APP_HORIZONTAL_PADDING);
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    const updateWidth = (): void => setWidth(readWidth());
    stdout.on("resize", updateWidth);
    return () => {
      stdout.off("resize", updateWidth);
    };
  }, [stdout]);

  return width;
}

function displayWidth(value: string): number {
  let width = 0;

  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) {
      width += 2;
      continue;
    }

    for (const character of segment) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && !/\p{Mark}/u.test(character) && !isZeroWidth(codePoint)) {
        width += isFullWidth(codePoint) ? 2 : 1;
      }
    }
  }

  return width;
}

function isZeroWidth(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x200d || codePoint === 0xfe0f;
}

function isFullWidth(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b2ff) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function statusText(status: ChangeStatus, error: string | undefined): string {
  if (status === "applied") {
    return "Changes applied.";
  }

  if (status === "discarded") {
    return "Changes discarded; no files changed.";
  }

  if (status === "failed") {
    return error === undefined ? "Changes could not be applied." : `Changes could not be applied: ${error}`;
  }

  return "Apply these changes? Press y to apply, n to discard.";
}

function statusColor(status: ChangeStatus): "gray" | "green" | "red" {
  if (status === "applied") {
    return "green";
  }

  if (status === "failed") {
    return "red";
  }

  return "gray";
}
