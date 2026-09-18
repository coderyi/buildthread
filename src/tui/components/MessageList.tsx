import React from "react";
import { Box, Text } from "ink";
import { DiffView, type ChangeStatus } from "./DiffView.js";

export interface TextUiMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

export interface ChangeUiMessage {
  readonly kind: "change";
  readonly id: string;
  readonly diff: string;
  readonly status: ChangeStatus;
  readonly error?: string;
}

export type UiMessage = TextUiMessage | ChangeUiMessage;

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
      {messages.map((message, index) =>
        "kind" in message ? (
          <DiffView
            key={message.id}
            diff={message.diff}
            status={message.status}
            {...(message.error === undefined ? {} : { error: message.error })}
          />
        ) : (
          <Box key={index} flexDirection="column" marginBottom={1}>
            <Text color={roleColor(message.role)}>{labelForRole(message.role)}</Text>
            <Text>{message.content}</Text>
          </Box>
        )
      )}
    </Box>
  );
}

function labelForRole(role: TextUiMessage["role"]): string {
  if (role === "user") {
    return "User";
  }

  if (role === "assistant") {
    return "Assistant";
  }

  return "System";
}

function roleColor(role: TextUiMessage["role"]): "cyan" | "green" | "yellow" {
  if (role === "user") {
    return "cyan";
  }

  if (role === "assistant") {
    return "green";
  }

  return "yellow";
}
