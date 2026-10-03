import { z } from 'zod';

/* Every tool takes this so the card can match the user: the model knows what
   language the user is writing in, the host's locale may not. It only
   affects the card; text answers stay English. */
export const languageInput = z.enum(['ar', 'en']).optional()
  .describe('The language the user is writing in: "ar" for Arabic, "en" for English. Sets the language of the card shown to the user (Arabic is right-to-left).');
