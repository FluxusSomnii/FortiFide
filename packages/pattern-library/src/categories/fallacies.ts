import type { PatternEntry } from "../types.js";

export const fallacyPatterns: PatternEntry[] = [
  {
    id: "ad-hominem",
    name: "Ad Hominem",
    category: "fallacy",
    definition:
      "A rhetorical pattern that attacks the character, motive, or attributes of a person making an argument rather than addressing the substance of the argument itself.",
    linguisticMarkers: [
      "what would you know about",
      "you're just a",
      "of course they'd say that",
      "consider the source",
      "they have no credibility",
      "what do you expect from",
    ],
    examples: [
      "You've never run a business, so your opinion on economics is worthless.",
      "Of course she supports that policy — she stands to profit from it.",
      "He dropped out of college, so why should we listen to his ideas?",
    ],
    counterExamples: [
      "The author disclosed a financial conflict of interest in the study.",
      "Her background in marine biology gives her relevant expertise here.",
      "The witness has a documented history of providing inaccurate testimony.",
    ],
  },
  {
    id: "straw-man",
    name: "Straw Man",
    category: "fallacy",
    definition:
      "A rhetorical pattern that misrepresents or oversimplifies an opposing argument to make it easier to attack.",
    linguisticMarkers: [
      "so what you're really saying is",
      "in other words, you want",
      "that's basically the same as",
      "you're essentially arguing that",
      "so you think we should just",
    ],
    examples: [
      "So you're saying we should just let everyone do whatever they want with no rules at all?",
      "My opponent essentially wants to destroy the entire healthcare system.",
      "In other words, you think we should just give up and do nothing.",
    ],
    counterExamples: [
      "If I understand correctly, your position is that the regulation should be revised rather than eliminated.",
      "To summarize your argument: you believe the timeline is too aggressive given current resources.",
      "Your proposal suggests increasing funding by 15% rather than restructuring the program.",
    ],
  },
  {
    id: "false-dichotomy",
    name: "False Dichotomy",
    category: "fallacy",
    definition:
      "A rhetorical pattern that presents only two options as if they are the only possibilities when additional alternatives exist.",
    linguisticMarkers: [
      "either...or",
      "you're either with us or against us",
      "there are only two choices",
      "the only option is",
      "if you're not...then you're",
      "it's one or the other",
    ],
    examples: [
      "You're either with us or you're against us — there's no middle ground.",
      "We can either cut the program entirely or accept the budget as-is.",
      "If you're not part of the solution, you're part of the problem.",
    ],
    counterExamples: [
      "The two main candidates are Smith and Jones, though write-in candidates are also accepted.",
      "The binary choice between surgery and no treatment is the standard medical framing for this condition.",
      "At this fork in the trail, you can go left toward the lake or right toward the summit.",
    ],
  },
  {
    id: "slippery-slope",
    name: "Slippery Slope",
    category: "fallacy",
    definition:
      "A rhetorical pattern that asserts a relatively small first step will inevitably lead to a chain of events culminating in a significant negative outcome, without establishing the causal links.",
    linguisticMarkers: [
      "next thing you know",
      "where does it end",
      "it's a slippery slope",
      "this will inevitably lead to",
      "once you start",
      "before you know it",
      "open the floodgates",
    ],
    examples: [
      "If we allow employees to work from home one day a week, next thing you know no one will come to the office at all.",
      "Once you start making exceptions to this rule, it's a slippery slope to having no standards whatsoever.",
      "If this regulation passes, it will inevitably lead to the government controlling every aspect of our lives.",
    ],
    counterExamples: [
      "Gradual erosion of wetlands over the past century has led to measurably worse flood outcomes.",
      "Research shows that early tobacco use increases the statistical likelihood of using other substances.",
      "Historical precedent shows that small regulatory changes in this sector have sometimes preceded larger reforms.",
    ],
  },
  {
    id: "tu-quoque",
    name: "Tu Quoque",
    category: "fallacy",
    definition:
      "Deflecting criticism by pointing to the accuser's own behaviour rather than addressing the argument.",
    linguisticMarkers: [
      "you do it too",
      "look who's talking",
      "that's rich coming from",
      "you're one to talk",
      "you're no better",
      "pot calling the kettle",
    ],
    examples: [
      "You criticise my spending? That's rich coming from someone who just bought a new car.",
      "Look who's talking — you're no better when it comes to meeting deadlines.",
    ],
    counterExamples: [
      "The same standard should apply to both parties in this negotiation.",
      "For consistency, we should evaluate our own practices using the same criteria.",
    ],
  },
  {
    id: "red-herring",
    name: "Red Herring",
    category: "fallacy",
    definition:
      "Introducing an irrelevant topic to divert attention from the original issue under discussion.",
    linguisticMarkers: [
      "but the real issue is",
      "what about",
      "let's not forget",
      "more importantly",
      "the bigger question is",
      "why aren't we talking about",
    ],
    examples: [
      "Why are we discussing the budget shortfall when the real issue is employee morale?",
      "Sure, the product has defects, but let's not forget how much we've invested in innovation.",
    ],
    counterExamples: [
      "Before we move on, I'd like to raise a related concern about the implementation timeline.",
      "The committee also noted a secondary issue that warrants its own discussion.",
    ],
  },
  {
    id: "moving-goalposts",
    name: "Moving Goalposts",
    category: "fallacy",
    definition:
      "Changing the criteria for proof or success after they have been met.",
    linguisticMarkers: [
      "yes but that doesn't count",
      "that's not what I meant",
      "the real test is",
      "that's not enough",
      "sure but now you need to",
      "what I really need to see",
    ],
    examples: [
      "You hit the sales target, yes, but the real test is whether you can sustain it next quarter.",
      "That doesn't count — what I really need to see is results under different conditions.",
    ],
    counterExamples: [
      "The Phase 1 milestone was met; Phase 2 has a different and pre-defined set of success criteria.",
      "The initial target was achieved, and the board has set an updated goal for the next period.",
    ],
  },
  {
    id: "circular-reasoning",
    name: "Circular Reasoning",
    category: "fallacy",
    definition:
      "Using the conclusion of an argument as one of its own premises.",
    linguisticMarkers: [
      "because it just is",
      "it's true because",
      "everyone knows it's right",
      "that's just how it works",
      "the reason is that it's",
      "it's the best because it's superior",
    ],
    examples: [
      "This is the best approach because it's superior to all the alternatives.",
      "He's trustworthy because he's an honest person — and honest people are trustworthy.",
    ],
    counterExamples: [
      "The hypothesis is supported by three independent lines of evidence.",
      "The policy is effective based on outcome data from the pilot programme.",
    ],
  },
  {
    id: "appeal-to-ignorance",
    name: "Appeal to Ignorance",
    category: "fallacy",
    definition:
      "Claiming something is true because it has not been proven false, or vice versa.",
    linguisticMarkers: [
      "no one has ever disproved",
      "you can't prove it doesn't",
      "there's no evidence against",
      "until you can show otherwise",
      "nobody has shown that",
      "absence of evidence",
    ],
    examples: [
      "No one has ever disproved the existence of this phenomenon, so it must be real.",
      "You can't prove this supplement doesn't work, so clearly it has some benefit.",
    ],
    counterExamples: [
      "The substance has not yet been tested, so its efficacy is currently unknown.",
      "No adverse effects were reported in the trial, though the sample size was small.",
    ],
  },
];
