# AI tutor: provider options and secure setup

## Current owner choice: OpenAI (2026-11-06)

OpenAI is selected for both the small tutor and programming-code review. The project now accepts `AI_PROVIDER="openai"`, uses only `https://api.openai.com/v1`, and reads the standard server-side `OPENAI_API_KEY` (or the existing `AI_API_KEY`). Default model: `gpt-6-luna`, configurable through `AI_MODEL`; initial `AI_OPENAI_REASONING_EFFORT="low"`. Requests use strict structured JSON and `store=false`. No client-side key, tools or automatic code application.

Provider/model settings are saved in ignored `.env.local`, mode600. **There is no key yet, and no live OpenAI request has been made.** Built-in/compiler hints continue working. The owner has been offered the OpenAI Developers plugin for project-key setup; installation/connection is not yet confirmed. After connecting it, use its API-key setup capability when available. Never ask the owner to paste a key in chat.

For manual setup, the owner can add `OPENAI_API_KEY="..."` locally to the ignored root `.env.local`; preserve all existing database settings. Restart the web server after the key is added, then make one deliberately small code-review check. Configuration status alone is not proof of a successful provider response. Code and compiler evidence are bounded and secret-looking values are redacted; a redacted source file cannot be auto-applied over the learner's original code.

Official sources verified for this setup: [API keys](https://developers.openai.com/api/docs/guides/api-keys), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). The historical provider options and checks below remain for reference.


The labs work without any of this. With no provider configured the tutor uses its built-in hints, which come from the simulators' and compilers' own findings, and the panel says the AI assistant is not configured.

## What the AI tutor does when configured

- It answers one typed question at a time about the hints already on screen.
- The server sends the provider only: the question, the text of the hint levels the learner has opened (unopened levels never reach the provider), the lab's deterministic diagnostics, and (optionally) bounded excerpts of the project's files with secret-looking values replaced.
- The provider gets no tools and cannot change the project. Its answer is cut down on the server to plain text, a confidence label and at most one target from the request's allowed targets, which come from the opened hints only.
- Limits: 10 questions a minute per learner session, 60 a minute for the site, and a daily token budget.

## Status on 2026-10-14

- Implemented and tested with a fake provider only (`npm run check:browser:tutor-ai`, 20 of 20; 35 server tests). Both real providers are tested only with the network replaced.
- **No request has ever been sent to a real provider**, because no key exists on this machine. Unknown until that happens: whether the live service accepts the request as built, the quality of the answers, and whether a real model keeps to the rules in its free text.

## Provider options

| Option | State in this project | What you need |
|---|---|---|
| Anthropic (Claude API) | Implemented (`AI_PROVIDER=anthropic`) | An Anthropic API account with billing, and an API key |
| Any OpenAI-compatible service (OpenAI, or a local model server that speaks the same chat-completions protocol) | Implemented (`AI_PROVIDER=openai_compatible`), tested with the network replaced only | A base URL, a model id, and a key (the key may be empty only for a server on this machine; a key is never sent over plain http to another machine) |
| Another provider with its own protocol (for example Google) | Not implemented. The server has a provider interface (`apps/web/lib/server/tutor/provider.ts`); a new provider is one file plus tests | Tell the lead which one; it has to be built and tested before use |
| No provider | Default | Nothing. Rule-based hints only |

Model choice (Anthropic), set with `AI_MODEL`: the default in the code is `claude-opus-5-5`, the most capable and the most expensive. Hints are short explanations of evidence that is already computed, so a smaller model such as `claude-haiku-5-5` may be enough and costs much less. This is a cost decision for the owner; nothing has been measured, because no real call has been made.

Cost control you can rely on: the per-session and site-wide rate limits, the daily token budget (`apps/web/lib/server/tutor/service.ts`), and a spending limit set in the provider's own console, which is the only hard cap.

## Secure setup

Do not paste the key into a chat, a commit, an issue or any file tracked by Git.

1. Create the key in the provider's console. Give it a name that identifies this project and, if the console offers it, a monthly spending limit.
2. On this machine, open the file `.env.local` in the repository root in your own editor. It is ignored by Git and readable only by your user account (mode 600). Add these lines yourself:

   ```
   AI_PROVIDER="anthropic"
   AI_API_KEY="<your key>"
   # AI_MODEL="claude-haiku-5-5"   # optional; leave out for the default
   ```

   or, for an OpenAI-compatible service:

   ```
   AI_PROVIDER="openai_compatible"
   AI_BASE_URL="https://api.openai.com/v1"     # or a local server, e.g. http://127.0.0.1:11434/v1
   AI_MODEL="<model id>"                        # required
   AI_API_KEY="<your key>"                      # may be empty only for a server on this machine
   # AI_RESPONSE_FORMAT="json_schema"           # json_schema | json_object | none, for older servers
   # AI_MAX_TOKENS_FIELD="max_completion_tokens" # or max_tokens, for older servers
   ```

   `AI_EFFORT` and `AI_REFUSAL_FALLBACK` apply to `anthropic` only.

3. Restart the web server (`npm run start` or `npm run dev`). The key is read only by the server process. It is never sent to the browser, never returned by an API route and never logged.
4. Check without spending anything: `curl -s http://localhost:3000/api/tutor/status` should answer `{"ai":"available","provider":"anthropic",...}` (or `openai_compatible`). This route does not contact the provider.
5. First real call, deliberately: run the one opt-in test, `npx vitest run apps/web/lib/server/tutor -t "real provider"`. It makes one small request and prints the outcome. After that, ask a question in the tutor panel in the browser.

To turn the AI tutor off again, remove or comment out `AI_PROVIDER` and restart the server. To rotate a key, replace it in `.env.local`, restart, and delete the old key in the provider's console.

For a deployment, set the same variables in the hosting platform's secret store, not in a file in the repository.

## What to tell the lead

Only this, in words: which provider, which model, and that the key is in `.env.local`. The lead and the team can then run the real-provider check without ever seeing the key's value in the conversation.
