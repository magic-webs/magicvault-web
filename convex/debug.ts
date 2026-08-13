import { query } from "./_generated/server";

export const getLastMessages = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("desc").take(20);
  },
});
