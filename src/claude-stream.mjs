export function translateCodexEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event?.type === "item.completed" && event?.item?.type === "agent_message") {
    const text = typeof event.item.text === "string" ? event.item.text : "";
    if (!text) return null;
    return {
      type: "content_block_delta",
      delta: {
        type: "text_delta",
        text: `${text}\n`,
      },
    };
  }

  if (event?.type === "turn.completed") {
    return { type: "result", result: "" };
  }

  return null;
}
