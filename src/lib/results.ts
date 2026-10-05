import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { reportError } from './errors.js';

/* Every tool answers with the same object twice: structuredContent for
   clients that read the output schema (and for the UI), and a JSON text block
   for those that don't.

   `text` lets a tool keep its text answer exactly as it was while the
   structured copy carries a few extra fields only the UI needs (Arabic
   names, the cover photo). */
export function ok(data: Record<string, unknown>, text: Record<string, unknown> = data): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(text) }],
    structuredContent: data
  };
}

/* A message the model can show the user as-is. */
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/* The ref lets the owner find the cause in mcp_errors (see errors.ts). */
export const genericError = (ref: string) =>
  `Something went wrong on our side (error ref ${ref}). Please try again in a moment.`;

/* Record an unexpected error and answer with the plain sentence. */
export async function failUnexpected(source: string, error: unknown, context: Record<string, unknown> = {}): Promise<CallToolResult> {
  return fail(genericError(await reportError(source, error, context)));
}

/* The SDK turns a thrown error into a tool result carrying error.message,
   which would hand DB internals to the model. Catch here instead: record the
   detail, show the user a plain sentence. `context` is the tool's arguments,
   so the error can be reproduced; phones are redacted before storing. */
export async function guard(tool: string, run: () => Promise<CallToolResult>, context: Record<string, unknown> = {}): Promise<CallToolResult> {
  try {
    return await run();
  } catch (e) {
    return failUnexpected(tool, e, context);
  }
}

/* Free text from the model goes into PostgREST filters. Keep letters (any
   script, so Arabic names match), digits, spaces and a little punctuation;
   drop everything PostgREST or LIKE treats as syntax: , ( ) " \ % _ * */
export function cleanText(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s'&.-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
