import { NextResponse } from "next/server";
import { translate } from "@/lib/i18n";
import { confirmLink, instagramConfig, linkStatus, rejectPendingLink, reply } from "@/lib/instagram";
import { z } from "zod";
import { HttpError, readJson, withUser } from "@/lib/http";

/** "a***@gmail.com" — enough for the Instagram side to recognise their own account. */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

/** The signed-in user approves the Instagram account that DM'd their code. */
export const POST = withUser(async (req, user) => {
  const config = instagramConfig();
  if (!config) throw new HttpError(404, "Instagram DM saving isn't set up on this server.");
  const { requestedAt } = await readJson(req, z.object({ requestedAt: z.string().max(40) }).strict(), 1_000);
  const igsid = await confirmLink(user.id, requestedAt);
  await reply(config, igsid, translate("ko", "Linked to AOP Inbox ({account}). Share any Reel to this chat and the shulker will keep it.", { account: maskEmail(user.email) }));
  return NextResponse.json(await linkStatus(user.id));
});

/** Not me: drop the pending request. */
export const DELETE = withUser(async (_req, user) => {
  await rejectPendingLink(user.id);
  return new NextResponse(null, { status: 204 });
});
