export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = parseEventData(event);

        if (data !== undefined) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const data = parseEventData(buffer);

    if (data !== undefined) {
      yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventData(event: string): string | undefined {
  const lines = event.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return dataLines.join("\n");
}
