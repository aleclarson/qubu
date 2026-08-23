import type { VerificationContext } from "../contract.js";

/** Load Qubu from the parent checkout without relying on Bun's symlink resolver. */
export async function loadQubu(
  context: VerificationContext,
): Promise<typeof import("qubu")> {
  const specifier = context.database.metadata?.qubuModule;
  if (!specifier) {
    throw new Error("Native scenario context is missing the Qubu module locator.");
  }
  return import(specifier) as Promise<typeof import("qubu")>;
}
