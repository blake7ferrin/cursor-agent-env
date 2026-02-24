# Doppler setup for the bridge

The bridge runs with secrets from [Doppler](https://doppler.com) so you never store API keys in code or in this repo.

## 1. Install Doppler CLI

- **Windows:** `scoop install doppler` or download from [Doppler CLI](https://docs.doppler.com/docs/install-cli).
- **macOS:** `brew install dopplerhq/cli/doppler`.
- **Linux:** See [Install CLI](https://docs.doppler.com/docs/install-cli).

## 2. Log in and create project

```bash
doppler login
doppler setup
```

Create a project (e.g. `cursor-bridge`) and a config (e.g. `dev` or `prd`).

## 3. Add secrets

In the Doppler dashboard (or via CLI), set:

| Secret | Description |
|--------|-------------|
| `CURSOR_API_KEY` | Cursor Cloud Agents API key from [Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations). Format: `key_...` |
| `AGENT_ENV_REPO` | Full GitHub URL of this repo (e.g. `https://github.com/your-org/cursor-agent-env`). Used as the repo when launching the orchestrator agent. |
| `TELEGRAM_BOT_TOKEN` | Optional. From [@BotFather](https://t.me/BotFather). Omit to disable Telegram. |

## 4. Run the bridge

From the `bridge/` directory:

```bash
doppler run -- node server.js
```

Or from repo root:

```bash
doppler run -- node bridge/server.js
```

Doppler injects the variables into the process; the bridge reads `process.env.CURSOR_API_KEY`, etc.

## Production / CI

- **Server or container:** Run `doppler run -- ...` and ensure the Doppler CLI is installed and authenticated (e.g. use a service token: `DOPPLER_TOKEN` in the environment).
- **GitHub Actions:** Use [Doppler GitHub Action](https://github.com/DopplerHQ/action) or store `CURSOR_API_KEY` as a repo secret and pass it to the workflow.

## Alternatives

If you don’t use Doppler, set the same env vars in your shell or in a `.env` file (and add `.env` to `.gitignore`). Never commit `.env` or API keys.
