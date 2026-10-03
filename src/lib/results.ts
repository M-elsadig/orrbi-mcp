import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/* Every tool answers with the same object twice: structuredContent for
   clients that read the output schema, and a JSON text block for those that
   don't. */
export function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data
  };
}

/* A message the model can show the user as-is. */
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export const GENERIC_ERROR =
  'Something went wrong on our side. Please try again in a moment.';

/* The SDK turns a thrown error into a tool result carrying error.message,
   which would hand DB internals to the model. Catch here instead: log the
   detail, show the user a plain sentence. */
export async function guard(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (e) {
    console.error(`[${tool}]`, e);
    return fail(GENERIC_ERROR);
  }
}

/* Free text from the model goes into PostgREST filters. Keep letters (any
   script, so Arabic names match), digits, spaces and a little punctuation;
   drop everything PostgREST or LIKE treats as syntax: , ( ) " \ % _ * */
export function cleanText(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s'&.-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
