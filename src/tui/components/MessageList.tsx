import React from "react";
import { Box, Text } from "ink";

export interface UiMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

interface MessageListProps {
  readonly messages: readonly UiMessage[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">Enter a request to inspect or edit this project.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} flexDirection="column" marginBottom={1}>
          <Text color={roleColor(message.role)}>{labelForRole(message.role)}</Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}

function labelForRole(role: UiMessage["role"]): string {
  if (role === "user") {
    return "User";
  }

  if (role === "assistant") {
    return "Assistant";
  }

  return "System";
}

function roleColor(role: UiMessage["role"]): "cyan" | "green" | "yellow" {
  if (role === "user") {
    return "cyan";
  }

  if (role === "assistant") {
    return "green";
  }

  return "yellow";
}
