import type { PatternEntry } from "../types.js";

export const manipulationPatterns: PatternEntry[] = [
  {
    id: "false-urgency",
    name: "False Urgency",
    category: "manipulation",
    definition:
      "A technique that creates artificial time pressure to prompt a decision before the audience has time to fully evaluate the situation.",
    linguisticMarkers: [
      "act now",
      "limited time",
      "before it's too late",
      "last chance",
      "don't wait",
      "expires soon",
      "only hours left",
      "running out of time",
    ],
    examples: [
      "Act now before this once-in-a-lifetime opportunity disappears forever!",
      "You only have 24 hours left to secure your spot.",
      "Don't wait — prices go up at midnight and they won't come back down.",
    ],
    counterExamples: [
      "The deadline for tax filing is April 15th.",
      "Early registration closes on March 1st, after which standard pricing applies.",
      "The event starts at 7pm; doors open at 6:30pm.",
    ],
  },
  {
    id: "scarcity-framing",
    name: "Scarcity Framing",
    category: "manipulation",
    definition:
      "A technique that emphasizes limited availability of a resource or opportunity to increase its perceived value.",
    linguisticMarkers: [
      "only a few left",
      "limited supply",
      "exclusive access",
      "while supplies last",
      "selling fast",
      "almost gone",
      "rare opportunity",
    ],
    examples: [
      "Only 3 seats remaining at this price — they're going fast!",
      "This exclusive membership is limited to just 100 people worldwide.",
      "We almost never offer this, and once it's gone, it's gone.",
    ],
    counterExamples: [
      "We have limited parking available; please carpool if possible.",
      "The limited edition print run is 500 copies, numbered and signed.",
      "Stock is low on this item due to supply chain delays.",
    ],
  },
  {
    id: "guilt-induction",
    name: "Guilt Induction",
    category: "manipulation",
    definition:
      "A technique that attempts to create feelings of guilt in the audience to influence their behavior or decisions.",
    linguisticMarkers: [
      "after all I've done",
      "you owe",
      "the least you could do",
      "how could you",
      "I sacrificed",
      "don't you care",
      "if you really loved",
    ],
    examples: [
      "After everything I've done for you, the least you could do is help me with this.",
      "If you really cared about the environment, you wouldn't drive to work.",
      "Don't you think you owe it to your family to make the right choice here?",
    ],
    counterExamples: [
      "I'd appreciate your help with this project if you have time.",
      "Carpooling or public transit can reduce carbon emissions significantly.",
      "Your family might benefit from discussing this decision together.",
    ],
  },
  {
    id: "fear-appeal",
    name: "Fear Appeal",
    category: "manipulation",
    definition:
      "A technique that presents a threat or danger, real or exaggerated, to motivate the audience toward a specific action.",
    linguisticMarkers: [
      "you could lose everything",
      "dangerous consequences",
      "what if the worst happens",
      "protect yourself before",
      "the threat is real",
      "you're at risk",
      "don't become a victim",
    ],
    examples: [
      "Without this security system, your family is completely vulnerable to break-ins.",
      "If you don't act now, you could lose everything you've worked for.",
      "The threat is real and growing — don't wait until it's too late to protect yourself.",
    ],
    counterExamples: [
      "Home security systems can reduce the likelihood of burglary.",
      "Diversifying investments helps manage financial risk over time.",
      "Wearing a seatbelt significantly reduces the risk of injury in a collision.",
    ],
  },
  {
    id: "gaslighting",
    name: "Gaslighting",
    category: "manipulation",
    definition:
      "Causing someone to question their own perception, memory, or judgment through persistent denial or contradiction.",
    linguisticMarkers: [
      "that never happened",
      "you're imagining things",
      "you're being too sensitive",
      "I never said that",
      "you're remembering it wrong",
      "no one else has a problem with this",
    ],
    examples: [
      "That never happened — you're imagining things. I never said we'd revisit the contract.",
      "You're remembering it wrong; everyone else in the meeting agrees with my version.",
    ],
    counterExamples: [
      "I don't recall that conversation, but let me check my notes to confirm.",
      "We may have different recollections — let's look at the meeting minutes.",
    ],
  },
  {
    id: "love-bombing",
    name: "Love Bombing",
    category: "manipulation",
    definition:
      "Overwhelming someone with excessive affection, praise, or attention to create dependency or obligation.",
    linguisticMarkers: [
      "you're the most important",
      "I've never met anyone like you",
      "you're absolutely perfect",
      "I can't do this without you",
      "you're my everything",
      "no one understands me like you",
    ],
    examples: [
      "You're the most talented person I've ever worked with — I truly can't do this without you on the team.",
      "I've never met a client like you; you're absolutely perfect for this exclusive programme.",
    ],
    counterExamples: [
      "Your contributions to the project have been consistently strong across all three milestones.",
      "The team values your expertise in database optimisation — it's been a real asset.",
    ],
  },
  {
    id: "isolation-tactic",
    name: "Isolation Tactic",
    category: "manipulation",
    definition:
      "Encouraging separation from outside perspectives, support networks, or dissenting voices.",
    linguisticMarkers: [
      "don't listen to them",
      "they don't understand",
      "you can only trust",
      "everyone else is lying",
      "I'm the only one who",
      "the others will mislead you",
    ],
    examples: [
      "Don't listen to your friends on this — they don't understand the opportunity the way I do.",
      "Everyone else will mislead you; I'm the only one giving you honest advice.",
    ],
    counterExamples: [
      "I'd recommend getting a second opinion from a specialist before making this decision.",
      "It may help to discuss this with your financial advisor as well.",
    ],
  },
  {
    id: "moving-baseline",
    name: "Moving Baseline",
    category: "manipulation",
    definition:
      "Gradually normalising increasingly extreme positions through incremental steps.",
    linguisticMarkers: [
      "it's just a small change",
      "barely any different",
      "just a minor adjustment",
      "one small step",
      "it's not that different from",
      "we already accepted",
    ],
    examples: [
      "We already accepted the last change, so this one is barely any different — just one more small step.",
      "It's just a minor adjustment to the policy; it's not that different from what we agreed to last year.",
    ],
    counterExamples: [
      "The phased rollout proceeds incrementally: 10% in Q1, 25% in Q2, 50% in Q3, and full deployment in Q4.",
      "Each stage of the clinical trial builds on the safety data established in the previous stage.",
    ],
  },
];
