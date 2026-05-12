import React from "react";
import { Box, Text } from "ink";

interface InputBoxProps {
  readonly value: string;
  readonly disabled: boolean;
}

export function InputBox({ value, disabled }: InputBoxProps): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color={disabled ? "gray" : "white"}>{disabled ? "Working..." : `> ${value}`}</Text>
    </Box>
  );
}
