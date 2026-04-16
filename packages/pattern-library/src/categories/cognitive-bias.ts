import type { PatternEntry } from "../types.js";

export const cognitiveBiasPatterns: PatternEntry[] = [
  {
    id: "anchoring",
    name: "Anchoring",
    category: "cognitive-bias",
    definition:
      "A technique that introduces a reference point — often an extreme or arbitrary number — to influence subsequent judgments and estimates.",
    linguisticMarkers: [
      "originally priced at",
      "valued at",
      "compared to",
      "normally costs",
      "was going to be",
      "a $500 value for just",
      "retail price",
    ],
    examples: [
      "Originally priced at $299, now available for the incredible price of just $49.",
      "Experts estimate the damage could reach $10 billion — our plan costs only $500 million.",
      "Similar consulting firms charge $1,000 per hour; our rate is a fraction of that.",
    ],
    counterExamples: [
      "The manufacturer's suggested retail price is $29.99.",
      "Comparable properties in this neighborhood have sold for between $350,000 and $400,000.",
      "The project was originally budgeted at $2 million but came in at $2.3 million due to material costs.",
    ],
  },
  {
    id: "availability-heuristic",
    name: "Availability Heuristic Exploitation",
    category: "cognitive-bias",
    definition:
      "A technique that emphasizes vivid, memorable, or recent examples to make a risk or outcome seem more common or probable than statistical evidence supports.",
    linguisticMarkers: [
      "just last week",
      "you've seen the headlines",
      "remember when",
      "it's happening everywhere",
      "we keep hearing about",
      "another case of",
      "time and time again",
    ],
    examples: [
      "You've seen the headlines — another shark attack just last week. The beaches aren't safe anymore.",
      "It's happening everywhere: just this month, three local businesses were robbed.",
      "We keep hearing about data breaches — it's only a matter of time before it happens to you.",
    ],
    counterExamples: [
      "According to CDC data, the annual incidence rate is 3.2 per 100,000 population.",
      "While the recent incident received significant media coverage, overall rates have declined 15% over the past decade.",
      "The National Safety Council reports that the lifetime odds of this event are approximately 1 in 500,000.",
    ],
  },
  {
    id: "sunk-cost-appeal",
    name: "Sunk Cost Appeal",
    category: "cognitive-bias",
    definition:
      "A technique that argues for continuing a course of action based on previously invested resources (time, money, effort) rather than on the prospective value of continuing.",
    linguisticMarkers: [
      "we've already invested",
      "come this far",
      "too late to turn back",
      "after all the time we've spent",
      "we can't just walk away",
      "it would be a waste to stop now",
      "we've put too much into this",
    ],
    examples: [
      "We've already invested $3 million in this project — we can't just walk away now.",
      "You've come this far in the program; it would be a waste to quit with only two modules left.",
      "After all the time and effort we've put into this relationship, we owe it to ourselves to keep trying.",
    ],
    counterExamples: [
      "The project has cost $3 million so far, and completing it will require an additional $5 million with uncertain returns.",
      "Two modules remain in the certification program, estimated at 40 additional hours of study.",
      "The committee reviewed the project's remaining costs and projected benefits before deciding whether to continue.",
    ],
  },
  {
    id: "confirmation-bias-trigger",
    name: "Confirmation Bias Triggering",
    category: "cognitive-bias",
    definition:
      "A technique that selectively presents information designed to align with the audience's pre-existing beliefs, making the argument feel self-evidently true.",
    linguisticMarkers: [
      "as you already know",
      "you've always known",
      "it's what we've been saying all along",
      "this confirms what",
      "just as you suspected",
      "we've known this all along",
      "proving what we always believed",
    ],
    examples: [
      "As you already know, this industry has been corrupt for years — this report just confirms it.",
      "Just as you suspected, the study proves exactly what we've been saying all along.",
      "This is what we've known all along — and now there's no denying it.",
    ],
    counterExamples: [
      "The new findings are consistent with the hypothesis proposed in the 2019 study.",
      "The results align with predictions made by the existing theoretical model.",
      "This data supports the conclusion that was suggested by preliminary analysis.",
    ],
  },
  {
    id: "dunning-kruger-appeal",
    name: "Dunning-Kruger Appeal",
    category: "cognitive-bias",
    definition:
      "Presenting overconfident claims on a complex topic while demonstrating limited depth of understanding.",
    linguisticMarkers: [
      "it's really simple",
      "I don't see why",
      "anyone can see that",
      "it's obvious",
      "all you have to do is",
      "I figured it out in five minutes",
    ],
    examples: [
      "Climate science is really simple — the temperature goes up and down, it's just natural cycles.",
      "I don't see why economists can't figure this out; all you have to do is print more money.",
    ],
    counterExamples: [
      "The basic principle is straightforward, though the implementation details are complex.",
      "At a high level, the process involves three steps, each with specific technical requirements.",
    ],
  },
  {
    id: "survivorship-bias",
    name: "Survivorship Bias",
    category: "cognitive-bias",
    definition:
      "Drawing conclusions from visible successes while overlooking the failures that are no longer visible.",
    linguisticMarkers: [
      "look at all the people who",
      "successful people all",
      "every great company",
      "the ones who made it",
      "winners always",
      "just look at",
    ],
    examples: [
      "Every successful entrepreneur dropped out of college — clearly higher education is unnecessary.",
      "Look at all the people who got rich from crypto; it's the smartest investment you can make.",
    ],
    counterExamples: [
      "Of 100 startups in the cohort, 11 survived past five years; here's what distinguished them.",
      "The study tracked both successful and unsuccessful applicants to identify differentiating factors.",
    ],
  },
  {
    id: "hindsight-bias",
    name: "Hindsight Bias",
    category: "cognitive-bias",
    definition:
      "Claiming an outcome was predictable or obvious after it has already occurred.",
    linguisticMarkers: [
      "I knew it all along",
      "it was obvious",
      "anyone could have seen",
      "I told you so",
      "we should have known",
      "it was inevitable",
      "clearly this was going to happen",
    ],
    examples: [
      "The market crash was obvious — anyone could have seen it coming.",
      "I knew all along that project was going to fail; the signs were right there.",
    ],
    counterExamples: [
      "In retrospect, several leading indicators pointed toward the downturn.",
      "A post-mortem analysis identified three early warning signs that were missed.",
    ],
  },
  {
    id: "halo-effect",
    name: "Halo Effect",
    category: "cognitive-bias",
    definition:
      "Attributing positive qualities across unrelated domains based on one positive trait or impression.",
    linguisticMarkers: [
      "someone like them",
      "if they're good at",
      "with their track record",
      "a person of their caliber",
      "they're successful so",
      "clearly talented in every way",
    ],
    examples: [
      "She's a brilliant surgeon, so her views on economic policy must be equally sound.",
      "He built a billion-dollar company — clearly he knows how to run a government too.",
    ],
    counterExamples: [
      "Her experience managing large hospital systems is directly relevant to this healthcare policy role.",
      "His supply chain expertise transfers well to this logistics consulting engagement.",
    ],
  },
  {
    id: "just-world-fallacy",
    name: "Just World Fallacy",
    category: "cognitive-bias",
    definition:
      "Implying that outcomes are deserved, so that success indicates virtue and misfortune indicates fault.",
    linguisticMarkers: [
      "they got what they deserved",
      "if they had just",
      "they brought it on themselves",
      "hard work always pays off",
      "you reap what you sow",
      "must have done something",
    ],
    examples: [
      "If they're struggling financially, they must not have worked hard enough.",
      "She got what was coming to her — you reap what you sow.",
    ],
    counterExamples: [
      "Studies show that socioeconomic outcomes correlate strongly with starting conditions.",
      "The investigation found that systemic factors contributed significantly to the outcome.",
    ],
  },
];
