import type { PatternEntry } from "../types.js";

export const authorityPatterns: PatternEntry[] = [
  {
    id: "appeal-to-authority",
    name: "Appeal to Authority",
    category: "authority",
    definition:
      "A technique that cites an authority figure or institution as evidence for a claim, particularly when the authority lacks relevant expertise in the subject.",
    linguisticMarkers: [
      "experts agree",
      "studies show",
      "according to",
      "endorsed by",
      "as recommended by",
      "the science is clear",
      "leading authorities say",
    ],
    examples: [
      "A Nobel Prize-winning physicist says this economic policy is the best approach.",
      "Nine out of ten doctors recommend this supplement for better sleep.",
      "As endorsed by celebrities and thought leaders everywhere.",
    ],
    counterExamples: [
      "According to the CDC, handwashing reduces the spread of respiratory illness.",
      "Peer-reviewed research published in Nature found a correlation between these variables.",
      "The structural engineer assessed the bridge and determined it needs reinforcement.",
    ],
  },
  {
    id: "bandwagon",
    name: "Bandwagon Effect",
    category: "authority",
    definition:
      "A technique that appeals to the popularity of a position or product as evidence of its validity or quality.",
    linguisticMarkers: [
      "everyone is",
      "millions of people",
      "join the movement",
      "don't be left behind",
      "the majority agrees",
      "most people choose",
      "trending",
    ],
    examples: [
      "Over 10 million people have already switched — don't be the last to join.",
      "Everyone in the industry is adopting this framework; you should too.",
      "Join the millions who have already discovered the secret to success.",
    ],
    counterExamples: [
      "This product has over 50,000 five-star reviews on independent platforms.",
      "The majority of voters approved the measure in the November election.",
      "Python is widely used in data science, with a large ecosystem of libraries.",
    ],
  },
  {
    id: "false-consensus",
    name: "False Consensus",
    category: "authority",
    definition:
      "A technique that overstates the degree of agreement or shared belief on an issue to make a position appear more widely held than it is.",
    linguisticMarkers: [
      "everybody knows",
      "it's common knowledge",
      "no one disagrees",
      "we all agree",
      "the consensus is clear",
      "anyone can see",
      "obviously everyone",
    ],
    examples: [
      "Everybody knows that this is the only reasonable approach to the problem.",
      "No serious person disagrees with this position anymore.",
      "We all agree that this is the right direction — let's move forward.",
    ],
    counterExamples: [
      "A survey of 2,000 respondents found that 73% supported the proposal.",
      "There is broad scientific consensus that the Earth's climate is warming.",
      "Most participants in the meeting agreed on the proposed timeline.",
    ],
  },
  {
    id: "credentialism",
    name: "Credentialism",
    category: "authority",
    definition:
      "Citing one's own credentials or titles as a substitute for presenting a substantive argument.",
    linguisticMarkers: [
      "as a doctor",
      "with my years of experience",
      "as someone who has",
      "I have a degree in",
      "in my professional opinion",
      "trust me, I'm a",
    ],
    examples: [
      "As a doctor, I can tell you that this supplement is all you need for heart health.",
      "With my twenty years in the industry, I know this approach is the only one that works.",
    ],
    counterExamples: [
      "As a licensed electrician, I can confirm this wiring violates the building code.",
      "My background in toxicology is relevant to evaluating this chemical exposure case.",
    ],
  },
  {
    id: "anonymous-authority",
    name: "Anonymous Authority",
    category: "authority",
    definition:
      "Referencing unnamed or vague experts, studies, or sources to lend credibility without verifiable attribution.",
    linguisticMarkers: [
      "studies show",
      "scientists say",
      "experts agree",
      "research has found",
      "they say that",
      "it's been proven",
      "sources confirm",
    ],
    examples: [
      "Scientists say this diet can reverse aging — you just have to try it.",
      "Research has found that successful people all share this one morning habit.",
    ],
    counterExamples: [
      "A 2023 study published in The Lancet found a 15% reduction in symptom severity.",
      "Dr. Sarah Chen's research at MIT demonstrated a correlation between these variables.",
    ],
  },
  {
    id: "appeal-to-tradition",
    name: "Appeal to Tradition",
    category: "authority",
    definition:
      "Arguing that a practice or belief is correct because it has been done or held for a long time.",
    linguisticMarkers: [
      "we've always done it this way",
      "it's tradition",
      "time-tested",
      "for generations",
      "the way it's always been",
      "our ancestors knew",
    ],
    examples: [
      "We've always done it this way, and there's no reason to change now.",
      "This remedy has been used for generations — that's proof enough that it works.",
    ],
    counterExamples: [
      "The traditional method has been validated by modern clinical trials.",
      "This fermentation technique has been refined over centuries and produces consistent results.",
    ],
  },
  {
    id: "appeal-to-novelty",
    name: "Appeal to Novelty",
    category: "authority",
    definition:
      "Arguing that something is superior simply because it is new, modern, or recent.",
    linguisticMarkers: [
      "cutting-edge",
      "the latest",
      "next generation",
      "modern approach",
      "outdated thinking",
      "this is the future",
      "move forward",
    ],
    examples: [
      "This is the latest technology — of course it's better than what you're using now.",
      "That approach is outdated thinking; the modern way is clearly superior.",
    ],
    counterExamples: [
      "The new version includes bug fixes and performance improvements documented in the changelog.",
      "Updated guidelines reflect new evidence from three recent randomised controlled trials.",
    ],
  },
  {
    id: "testimonial",
    name: "Testimonial",
    category: "authority",
    definition:
      "Using a specific person's endorsement to validate a claim regardless of their relevant expertise.",
    linguisticMarkers: [
      "personally recommends",
      "changed my life",
      "I swear by",
      "take it from me",
      "just ask",
      "hear it from",
    ],
    examples: [
      "This famous athlete personally recommends this financial planning service.",
      "A popular actress swears by this skincare routine — it changed her life completely.",
    ],
    counterExamples: [
      "The patient reported significant improvement in mobility after six weeks of physical therapy.",
      "Three beta testers independently confirmed the bug was resolved in the latest build.",
    ],
  },
];
