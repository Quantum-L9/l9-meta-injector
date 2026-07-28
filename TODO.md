# TODO

## LLM routing

- **Wire LLM calls through `Quantum-L9/LLM-Router`** instead of pointing `llm-base-url`
  directly at `https://api.openai.com/v1`. Today `action.yml`'s `llm-base-url` /
  `llm-model` / `llm-api-key` inputs (see README.md "GitHub Action" section) go
  straight to OpenAI via `src/llm.ts`'s `makeOpenAIAdapter`, hardcoding the
  provider/model choice in every caller's workflow YAML.
  - Once `LLM-Router` exposes an OpenAI-chat-completions-compatible endpoint, this
    should be a drop-in `llm-base-url` swap (`makeOpenAIAdapter` already speaks that
    wire format) — no `src/llm.ts` changes expected, just default/documentation
    changes in `action.yml` and `README.md`.
  - Would let the router pick/failover models and centralize spend controls across
    all `Quantum-L9` repos consuming this action, instead of each caller pinning a
    literal model name (currently `gpt-5-nano`, chosen 2026-07 as OpenAI's cheapest
    current model for this classification-shaped workload).
  - Ref: https://github.com/Quantum-L9/LLM-Router
