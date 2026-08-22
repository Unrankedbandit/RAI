"""The shared agent loop: plan -> tool call -> observe -> repeat until the
agent emits its contract JSON. Every specialist agent uses this exact loop
with a different role prompt, tool whitelist, and output schema."""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Callable

import anthropic
from pydantic import BaseModel, ValidationError

from ..obs import Trace, set_current_trace

MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "8"))

# Provider selection: "openai" — any OpenAI-compatible endpoint, DEFAULT: the
# Fireworks bridge (hackathon.josephbissell.com).
# "anthropic" routes to direct Claude instead (Kiran's path).
PROVIDER = os.getenv("LLM_PROVIDER", "openai")

# Claude Opus 5 — the most capable model for long-horizon agentic work, which
# is what this pipeline is. Override per-role if a cheaper tier suffices.
LLM_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5")

# OpenAI-compatible bridge config (PROVIDER=openai).
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://hackathon.josephbissell.com/v1")
LLM_OPENAI_MODEL = os.getenv("LLM_MODEL", "kimi-latest")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
# Cap generated text per turn — long generations are what trips the bridge's
# 524 gateway timeout — and retry transient failures instead of aborting the
# run. The bridge also sits behind Cloudflare bot protection: request bursts
# earn a short 403 ban (observed clearing in ~90s), so concurrency is throttled
# and 403s ride out with backoff instead of failing the run.
OPENAI_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "4096"))
OPENAI_RETRIES = int(os.getenv("LLM_RETRIES", "5"))
_OPENAI_BACKOFF = (5, 15, 30, 45)  # seconds between attempts; spans the ~90s block
_LLM_SEMAPHORE: asyncio.Semaphore | None = None


def _llm_semaphore() -> asyncio.Semaphore:
    """Process-wide cap on concurrent model calls (built lazily so it binds to
    the running event loop)."""
    global _LLM_SEMAPHORE
    if _LLM_SEMAPHORE is None:
        _LLM_SEMAPHORE = asyncio.Semaphore(int(os.getenv("LLM_MAX_CONCURRENCY", "3")))
    return _LLM_SEMAPHORE

# Caps thinking *and* response text together. Adaptive thinking is on by
# default on Opus 5, so a budget sized only for the answer truncates mid-turn.
MAX_TOKENS = int(os.getenv("AGENT_MAX_TOKENS", "16000"))

# low | medium | high | xhigh | max. `high` is the API default and a sane
# starting point; `xhigh` buys more tool use and deeper planning per turn but
# wants a much larger MAX_TOKENS to go with it.
EFFORT = os.getenv("AGENT_EFFORT", "high")

ToolFn = Callable[..., Any]

# Reads ANTHROPIC_API_KEY from the environment. One client for the process:
# it pools connections across every agent in the fan-out.
_client = anthropic.AsyncAnthropic()

_JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _extract_json(text: str) -> Any:
    """Parse the model's contract JSON, salvaging prose-wrapped output. Small
    models often wrap JSON in chatter or fences — find the outermost {...}."""
    text = _JSON_FENCE.sub("", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


async def _openai_chat(messages: list[dict], role_prompt: str, tools: dict) -> dict:
    """One call against an OpenAI-compatible endpoint (the Fireworks bridge),
    with retry on transient 5xx (the bridge's 524 gateway timeout)."""
    import httpx
    payload: dict[str, Any] = {
        "model": LLM_OPENAI_MODEL,
        "messages": [{"role": "system", "content": role_prompt}] + messages,
        "temperature": 0,
        "max_tokens": OPENAI_MAX_TOKENS,
    }
    if tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": (fn.__doc__ or name).strip(),
                    "parameters": getattr(fn, "schema", {"type": "object", "properties": {}}),
                },
            }
            for name, fn in tools.items()
        ]
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    last: Exception | None = None
    for attempt in range(OPENAI_RETRIES):
        try:
            async with _llm_semaphore():
                async with httpx.AsyncClient(timeout=180) as client:
                    r = await client.post(
                        f"{LLM_BASE_URL}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                    r.raise_for_status()
                    return r.json()["choices"][0]["message"]
        except httpx.HTTPStatusError as e:
            last = e
            code = e.response.status_code
            # 429 = rate limit, 403 = Cloudflare ban, 5xx/524 = gateway timeout.
            # 400 is retried too — this bridge intermittently 400s on valid
            # requests (observed on the same payload that succeeds on retry),
            # so strict 4xx semantics don't hold here.
            retryable = code >= 400 and code != 401 and code != 404
            if retryable and attempt < OPENAI_RETRIES - 1:
                retry_after = e.response.headers.get("retry-after")
                wait = (
                    int(retry_after)
                    if retry_after and retry_after.isdigit()
                    else _OPENAI_BACKOFF[min(attempt, len(_OPENAI_BACKOFF) - 1)]
                )
                await asyncio.sleep(wait)
                continue
            raise
    raise last  # unreachable, satisfies type checkers


class AgentDidNotConverge(Exception):
    pass


class AgentRefused(Exception):
    """Safety classifiers declined the request. Not a bug in the pipeline —
    the cyber and bio classifiers occasionally fire on benign diligence text."""


class Agent:
    def __init__(
        self,
        name: str,
        role_prompt: str,
        contract: type[BaseModel],
        tools: dict[str, ToolFn] | None = None,
        on_status: Callable[[str], None] | None = None,
        trace: "Trace | None" = None,
    ):
        self.name = name
        self.role_prompt = role_prompt
        self.contract = contract
        self.tools = tools or {}
        self.on_status = on_status or (lambda msg: None)
        self.trace = (trace or Trace()).bind(agent=name)

    def _tool_specs(self) -> list[dict]:
        return [
            {
                "name": name,
                "description": (fn.__doc__ or name).strip(),
                "input_schema": getattr(fn, "schema", {"type": "object", "properties": {}}),
            }
            for name, fn in self.tools.items()
        ]

    async def _chat(self, messages: list[dict], step: int):
        kwargs: dict[str, Any] = {
            "model": LLM_MODEL,
            "max_tokens": MAX_TOKENS,
            "system": self.role_prompt,
            "messages": messages,
            # Adaptive rather than a fixed token budget: Claude sizes its own
            # reasoning per turn. Fixed `budget_tokens` is rejected on Opus 5.
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": EFFORT},
        }
        if self.tools:
            kwargs["tools"] = self._tool_specs()

        approx_chars = sum(len(str(m.get("content") or "")) for m in messages)
        with self.trace.span(
            "llm", f"step {step}/{MAX_STEPS} → {LLM_MODEL}",
            messages=len(messages), promptChars=approx_chars, effort=EFFORT,
        ) as sp:
            try:
                # No `temperature`: sampling parameters return a 400 on Opus 5.
                # Steer behaviour through the role prompt instead.
                response = await _client.messages.create(**kwargs)
            except anthropic.APIStatusError as e:
                # Surface the provider's message — "400 Bad Request" alone has
                # cost people hours on a malformed tool schema.
                self.trace.error(
                    "llm.http", f"{e.status_code} from the Anthropic API",
                    body=str(getattr(e, "body", None) or e)[:600],
                )
                raise

            usage = response.usage
            sp["inputTokens"] = getattr(usage, "input_tokens", None)
            sp["outputTokens"] = getattr(usage, "output_tokens", None)
            sp["stopReason"] = response.stop_reason
            sp["toolCalls"] = sum(1 for b in response.content if b.type == "tool_use")
            return response

    async def _run_openai(self, task: str, context: dict[str, Any] | None) -> BaseModel:
        """Same loop over an OpenAI-compatible endpoint (message format differs:
        system rides as a message, tool results are role=tool messages)."""
        self.on_status(f"[{self.name}] starting ({LLM_OPENAI_MODEL})")
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": (
                    f"{task}\n\nContext:\n{json.dumps(context or {}, default=str)[:9000]}\n\n"
                    f"Use tools if you need more information. When done, reply with ONLY JSON "
                    f"matching this schema:\n{json.dumps(self.contract.model_json_schema())}"
                ),
            },
        ]
        for _ in range(MAX_STEPS):
            msg = await _openai_chat(messages, self.role_prompt, self.tools)
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                text = _JSON_FENCE.sub("", msg.get("content") or "")
                try:
                    result = self.contract.model_validate(_extract_json(text))
                    self.on_status(f"[{self.name}] done")
                    return result
                except (json.JSONDecodeError, ValidationError, TypeError) as e:
                    messages.append({"role": "assistant", "content": msg.get("content") or ""})
                    messages.append({
                        "role": "user",
                        "content": f"Invalid output ({e}). Return ONLY valid JSON matching the schema.",
                    })
                    continue

            messages.append(msg)
            for call in tool_calls:
                fn_name = call["function"]["name"]
                args = json.loads(call["function"].get("arguments") or "{}")
                self.on_status(f"[{self.name}] {fn_name}({json.dumps(args, default=str)[:80]})")
                try:
                    output = (
                        await asyncio.to_thread(self.tools[fn_name], **args)
                        if fn_name in self.tools
                        else f"unknown tool {fn_name}"
                    )
                except Exception as e:  # tool failures are observations, not crashes
                    output = f"tool error: {e}"
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": str(output)[:8000],
                })

        raise AgentDidNotConverge(self.name)

    async def run(self, task: str, context: dict[str, Any] | None = None) -> BaseModel:
        # Set before the provider branch so the bridge path is traced too.
        set_current_trace(self.trace)
        if PROVIDER == "openai":
            return await self._run_openai(task, context)
        self.on_status(f"[{self.name}] starting")
        # The role prompt rides in `system`, not as a message — that keeps the
        # cached prefix stable across every turn of the loop.
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": (
                    f"{task}\n\nContext:\n{json.dumps(context or {}, default=str)[:9000]}\n\n"
                    f"Use tools if you need more information. When done, reply with ONLY JSON "
                    f"matching this schema:\n{json.dumps(self.contract.model_json_schema())}"
                ),
            },
        ]

        retries = 0
        with self.trace.span(
            "agent", f"{self.name} → {self.contract.__name__}",
            tools=sorted(self.tools), maxSteps=MAX_STEPS,
        ) as agent_span:
            for step in range(1, MAX_STEPS + 1):
                response = await self._chat(messages, step)

                if response.stop_reason == "refusal":
                    detail = getattr(response.stop_details, "category", None)
                    self.trace.error(
                        "agent.refused",
                        f"{self.name}: safety classifiers declined the request",
                        category=detail,
                    )
                    raise AgentRefused(f"{self.name}: refused ({detail})")

                # Echo the whole assistant turn back — thinking blocks included
                # and unmodified. Editing or dropping them breaks the next turn.
                messages.append({"role": "assistant", "content": response.content})

                tool_uses = [b for b in response.content if b.type == "tool_use"]

                if not tool_uses:
                    text = "".join(b.text for b in response.content if b.type == "text")
                    try:
                        result = self.contract.model_validate(
                            _extract_json(text)
                        )
                    except (json.JSONDecodeError, ValidationError, TypeError) as e:
                        # Previously invisible: the agent would silently burn a
                        # step and retry, so a run that failed on a schema
                        # mismatch looked identical to one that was just slow.
                        retries += 1
                        self.trace.warn(
                            "contract.invalid",
                            f"{type(e).__name__} on step {step} — asking for valid JSON again",
                            error=str(e)[:400],
                            rawPreview=text[:400],
                        )
                        self.on_status(f"[{self.name}] invalid output, retrying")
                        messages.append({
                            "role": "user",
                            "content": f"Invalid output ({e}). Return ONLY valid JSON matching the schema.",
                        })
                        continue

                    agent_span["steps"] = step
                    agent_span["retries"] = retries
                    self.trace.event(
                        "agent.contract", f"{self.contract.__name__} validated",
                        steps=step, retries=retries,
                    )
                    self.on_status(f"[{self.name}] done")
                    return result

                results = []
                for call in tool_uses:
                    args = call.input or {}
                    self.on_status(f"[{self.name}] {call.name}({json.dumps(args, default=str)[:80]})")

                    with self.trace.span("tool", f"{call.name}", args=args) as ts:
                        if call.name not in self.tools:
                            # Not an exception — the model hallucinated a tool.
                            # Worth flagging: it usually means the whitelist and
                            # the role prompt disagree.
                            self.trace.warn(
                                "tool.unknown",
                                f"{self.name} called {call.name!r}, not in its whitelist",
                                available=sorted(self.tools),
                            )
                            output, is_error = f"unknown tool {call.name}", True
                            ts["ok"] = False
                        else:
                            try:
                                # Tools are synchronous and some are slow — a
                                # scrape or fetch takes seconds. Calling them
                                # inline would block the event loop and stall
                                # every other agent in the same gather.
                                output = await asyncio.to_thread(self.tools[call.name], **args)
                                is_error = False
                                ts["ok"] = True
                            except Exception as e:  # tool failures are observations, not crashes
                                output, is_error = f"tool error: {e}", True
                                ts["ok"] = False
                                ts["error"] = str(e)[:300]
                                self.trace.warn("tool.failed", f"{call.name}: {e}")

                        rendered = str(output)
                        ts["resultChars"] = len(rendered)
                        if len(rendered) > 8000:
                            # Silent truncation hides why an agent "ignored" a
                            # document it was given.
                            ts["truncated"] = True
                            self.trace.warn(
                                "tool.truncated",
                                f"{call.name} returned {len(rendered)} chars, truncated to 8000",
                            )

                    results.append({
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": rendered[:8000],
                        "is_error": is_error,
                    })

                # Every tool_result for a turn goes back in ONE user message —
                # splitting them trains the model out of parallel tool calls.
                messages.append({"role": "user", "content": results})

            agent_span["steps"] = MAX_STEPS
            agent_span["retries"] = retries
            self.trace.error(
                "agent.no_converge",
                f"{self.name} exhausted {MAX_STEPS} steps without producing valid "
                f"{self.contract.__name__} ({retries} schema retries)",
            )
            raise AgentDidNotConverge(
                f"{self.name} did not converge in {MAX_STEPS} steps "
                f"({retries} invalid-output retries) for contract {self.contract.__name__}"
            )
