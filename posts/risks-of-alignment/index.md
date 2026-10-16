---
title: "Does increasing 'alignment' increase risk?"
date: "2023-02-09"
author: "Ken Arnold"
categories: ["ai"]
featured: 1
---

OpenAI's [stated purpose](https://openai.com/alignment/) for working on the sort of adjustments to language models that led to ChatGPT was to "align" their behavior with human goals. Their motivation for this is *safety*, i.e., ensuring that the AI doesn't do harmful things. That sounds noble, indeed. But is it?

The biggest practical effect of this so-called "alignment" work was actually in molding the model into the form of a servant that can obey instructions. (Inside current models like ChatGPT, "obeying an instruction" looks less like planning steps towards a goal, more like imitating the behavior of people who have had that goal before; see my post on [personas and RLHF](../personas/index.qmd) for details.) And, surprise, people found that servant collection-of-personas *much more useful* than the un-"aligned" language model. (To be explicit: the "goal" of the language model is simply to be unsurprised by the Internet.)

Since people found it useful (combined with the [theatrical show of the chat interface](https://www.tabletmag.com/sections/news/articles/oy-ai-jaron-lanier)), ChatGPT *got used*. Far more than any of their previous work.

Was OpenAI's effort towards AI "safety" successful? Perhaps the *relative* amount of harm per output was decreased, but the main effect was making the system far more successful, increasing its influence and the likelihood of undesired behaviors that they didn't think to try to "align" (e.g., generating StackOverflow answers, which the community [had to quickly ban](https://meta.stackoverflow.com/questions/421831/temporary-policy-chatgpt-is-banned)).
