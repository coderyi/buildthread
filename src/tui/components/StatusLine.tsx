import React from "react";
import { Box, Text } from "ink";

interface StatusLineProps {
  readonly status: string;
}

export function StatusLine({ status }: StatusLineProps): React.ReactElement {
  return (
    <Box>
      <Text color="gray">{status}</Text>
    </Box>
  );
}
