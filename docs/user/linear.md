# Linear

Start a new worktree from one of your Linear issues. T3 Code names the branch after the issue and puts the issue text in the composer, so the agent starts with the full task.

## Connect

1. In Linear, open **Settings → Security & access → Personal API keys** and create a key.
2. In T3 Code, open **Settings → Integrations → Linear**, paste the key, and choose **Connect**.

T3 Code checks the key with Linear before saving it. The key is stored on the environment you are connected to and never sent to other clients. **Disconnect** removes it.

Server operators can also set the `T3CODE_LINEAR_API_KEY` environment variable. It wins over a key saved in Settings.

## Start from an issue

1. Start a new chat and switch the environment mode to **New worktree**.
2. Choose **Linear** beside the branch selector. The list shows open issues assigned to you, active work first, newest update first inside each status. Type to search by key or title.
3. Pick an issue.

After the pick:

- The composer holds the issue key, title, link, description, and the most recent comments. Edit it as you like before sending.
- The worktree branch will be named after the issue, using the branch name Linear suggests when your workspace has one.
- Nothing is created yet. The worktree and branch appear when you send the first message, as usual.

If a branch with that name already exists, T3 Code tells you and leaves the branch unchanged. Pick the existing branch from the branch selector to continue that work.

## Limits

- Done and canceled issues are not listed.
- Up to 500 issues are loaded. Use the search box to narrow the list.
- Images in issues and comments arrive as links. Agents cannot open Linear images.
- Comments are capped at the 20 most recent, and very long comments are cut short.
