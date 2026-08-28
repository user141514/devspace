# ChatGPT Project Worker Direction

Date: 2026-08-28
Status: Research direction, not implemented

## Why this is separate from Host Worker provider fallback

The current Host Worker provider-fallback work solves a concrete execution gap: when an MCP host does not expose `sampling/createMessage`, DevSpace can still execute `hw_*` workers by routing each worker to an independent local provider session, with Codex as the primary backend.

That is an **orchestration-level fork**. DevSpace creates multiple worker lifecycles and multiple provider inference sessions, but it does not fork the current ChatGPT model's hidden reasoning state.

A different research direction is to use **physical ChatGPT conversations inside the same ChatGPT Project as worker backends**. In that model, DevSpace would create or bind several real project conversations, dispatch independent tasks to them, collect their responses, and return those results to the coordinating conversation.

These two models must not be conflated:

```text
Current Host Worker provider route
main ChatGPT conversation
  -> DevSpace hw_A / hw_B / hw_C
  -> independent Codex/Pi/Claude provider sessions

Research direction
main ChatGPT project conversation
  -> DevSpace
  -> physical ChatGPT project conversation A
  -> physical ChatGPT project conversation B
  -> physical ChatGPT project conversation C
```

## Potential value

Physical project conversations would provide a closer cognitive environment to the coordinating ChatGPT conversation than local CLI providers. They may inherit the same Project instructions, files, and project-scoped context while still producing independent inference histories.

This still would **not** clone or serialize the coordinator's hidden reasoning state. Each conversation would reconstruct its own reasoning from explicit project context and dispatched task context.

## Current boundary

OpenAI exposes API-platform conversation objects, but there is no documented developer primitive for creating and controlling ChatGPT Project conversations as worker objects. Existing third-party experiments appear to use the ChatGPT web application and internal web transport to create and drive physical conversations.

Therefore this direction is research-only for now. It should not be folded into the Host Worker provider-fallback implementation until the transport, lifecycle, authentication, project scoping, result collection, and product-policy boundaries are understood.

## Next research question

Study existing implementations that drive physical ChatGPT conversations, especially `nek0us/ChatGPT`, and answer:

1. How is a new physical conversation created and associated with a Project?
2. Does the implementation depend on DOM automation, internal web endpoints, or both?
3. How are login state, security headers, streaming responses, conversation IDs, and project IDs maintained?
4. Can multiple conversations run concurrently and be addressed reliably?
5. Which parts could be isolated behind a future DevSpace runtime boundary without coupling the Host Worker core to ChatGPT web internals?

No implementation is authorized by this note.