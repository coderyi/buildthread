import React from "react";
import { Box, Text } from "ink";

interface DiffViewProps {
  readonly diff: string;
}

export function DiffView({ diff }: DiffViewProps): React.ReactElement | null {
  if (diff.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Proposed changes</Text>
      <Text>{diff}</Text>
      <Text color="gray">Apply these changes? Press y to apply, n to discard.</Text>
    </Box>
  );
}
