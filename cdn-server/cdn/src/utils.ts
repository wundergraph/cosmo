export async function streamToJSON(readableStream: ReadableStream) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    result += decoder.decode(value, { stream: true });
  }

  // Parse the accumulated result string into JSON
  return JSON.parse(result);
}
