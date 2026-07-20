# Why I Built repointel: Staying Oriented While Building with AI

I talk to my code. Literally. 

I open ChatGPT's voice mode, speak into it, and paste the transcript into Claude. That's my workflow. No typing, no memorizing commands — just conversation.

But there's a problem. When you're deep in a build with an AI assistant, you lose track of where you are. The codebase grows. Context fragments. You end up stuck, unsure what's implemented, what's broken, or what to do next.

That's why I built **repointel**.

## The Real Problem

It's not about tokens or context windows. It's about entropy.

Every file you create, every import you add, every feature you half-finish — it all accumulates. Your app becomes a maze, and neither you nor your AI knows the way out.

I kept hitting the same wall: "Wait, did that feature actually land? Is it connected to the rest of the app? What's the current state of this thing?"

## How I Actually Use It

I don't memorize CLI flags. I just talk:

> "Run repointel on this project and help me understand where we are."

> "Use repointel to update the spec for user authentication."

> "Let's see if that feature landed across all the slices."

The LLM runs the commands. repointel does the work — indexing files, tracing imports, building the picture. Then I iterate.

## The Workflow That Works

```
Spec → Plan → Task → Execute → Re-index
```

1. **Spec** — I define what I'm building. repointel manages the `.specify/` structure (it's based on GitHub's SpecKit).
2. **Plan** — The spec becomes a technical plan. If the plan's wrong, I update it through conversation.
3. **Task** — The plan becomes actionable tasks.
4. **Execute** — I build it with my LLM.
5. **Re-index** — I run repointel again to see where I landed. Did the implementation actually propagate through the app? What's still broken?

This cycle keeps me oriented. When I'm stuck in that "where am I?" phase, I run `repointel ooda` and get the current state.

## What It's Really Doing

The core insight: **follow the imports**.

Starting from any file, repointel walks the import tree. What does this file import? What do those files import? It keeps going until it maps that entire slice of your app.

This is how you answer "did that feature actually land?" — you trace the connections and see if they're wired up.

It also:

- Generates Mermaid diagrams of your architecture
- Extracts focused context slices (not your whole codebase)
- Tracks specs across context switches
- Detects anti-patterns in React code

But the real value is orientation. Knowing where you are.

## Why Voice → Text → LLM?

I'm talking to you right now. This entire post started as me speaking into ChatGPT, then pasting into Claude.

Why? Because when I type, I self-edit. I second-guess. I lose momentum.

When I talk, I just say what I mean. The LLM can handle the rough edges. And repointel can handle the codebase complexity.

The combination — voice for ideas, LLM for execution, repointel for orientation — is how I actually ship.

## Try It

```bash
npm install -g repointel
cd your-project
repointel ooda
```

Then just tell your LLM: "Run repointel and help me understand where we are."

---

Built by [Nick Achee](https://nickachee.xyz) • [consultnta.com](https://consultnta.com)

Check it out: [github.com/Nick-Achee/repointel](https://github.com/Nick-Achee/repointel)
